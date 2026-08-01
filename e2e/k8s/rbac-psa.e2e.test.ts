import { beforeAll, describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { requireConfig, until } from "../helpers.ts";

// Proves the manager is contained even if it is compromised, via
// least-privilege RBAC and PSA `restricted` blocking privileged pods.
describe("Manager RBAC containment + PSA rejection (e2e)", () => {
  const server = () => Deno.env.get("K8S_E2E_SERVER") ?? "";
  const token = () => Deno.env.get("K8S_E2E_TOKEN") ?? "";

  beforeAll(() =>
    requireConfig({
      env: ["K8S_E2E_SERVER", "K8S_E2E_TOKEN", "K8S_E2E_CA"],
      hint: "run via deno task test:e2e:k8s rbac-psa (it derives them from " +
        "the k3d cluster).",
    })
  );

  // Deno's fetch trusts the cluster CA via an explicit HTTP client.
  const asManager = (path: string, init?: RequestInit) => {
    const client = Deno.createHttpClient({
      caCerts: [Deno.readTextFileSync(Deno.env.get("K8S_E2E_CA") ?? "")],
    });
    return fetch(
      `${server()}${path}`,
      {
        ...init,
        headers: {
          Authorization: `Bearer ${token()}`,
          ...(init?.headers ?? {}),
        },
        client,
      } as RequestInit & { client: unknown },
    );
  };

  it("the manager ServiceAccount is contained by its Role", async () => {
    // A cross-namespace secret read must return 403, since the Role is
    // namespace-scoped.
    const crossNs = await asManager("/api/v1/namespaces/kube-system/secrets");
    expect(crossNs.status).toBe(403);
    await crossNs.body?.cancel();

    // Self-escalation must return 403 too, since the Role grants no RBAC
    // verbs.
    const escalate = await asManager(
      "/apis/rbac.authorization.k8s.io/v1/namespaces/p0rt1on/roles/p0rt1on-manager",
      {
        method: "PATCH",
        headers: { "Content-Type": "application/merge-patch+json" },
        body: JSON.stringify({ rules: [] }),
      },
    );
    expect(escalate.status).toBe(403);
    await escalate.body?.cancel();

    // Listing cluster-scoped nodes must return 403 too.
    const nodes = await asManager("/api/v1/nodes");
    expect(nodes.status).toBe(403);
    await nodes.body?.cancel();

    // The leak-check contract allows `get` on named PVCs but denies `list`.
    const list = await asManager(
      "/api/v1/namespaces/p0rt1on/persistentvolumeclaims",
    );
    expect(list.status).toBe(403);
    await list.body?.cancel();
  });

  it(
    "PSA restricted rejects a privileged pod in the namespace",
    async () => {
      // Proves PSA rejection via a StatefulSet, since the Role cannot
      // create pods directly; it is admitted, but its pod never appears.
      const res = await asManager(
        "/apis/apps/v1/namespaces/p0rt1on/statefulsets/it-priv?fieldManager=p0rt1on&force=true",
        {
          method: "PATCH",
          headers: { "Content-Type": "application/apply-patch+yaml" },
          body: JSON.stringify({
            apiVersion: "apps/v1",
            kind: "StatefulSet",
            metadata: { name: "it-priv", namespace: "p0rt1on" },
            spec: {
              replicas: 1,
              serviceName: "it-priv",
              selector: { matchLabels: { app: "it-priv" } },
              template: {
                metadata: { labels: { app: "it-priv" } },
                spec: {
                  containers: [{
                    name: "priv",
                    image: "busybox",
                    securityContext: { privileged: true },
                  }],
                },
              },
            },
          }),
        },
      );
      try {
        expect(res.status).toBeLessThan(500);
        await res.body?.cancel();
        // The FailedCreate event names the violation, giving positive
        // evidence of the rejection.
        const rejection = await until(
          "PSA FailedCreate event",
          async () => {
            const events = await asManager(
              "/api/v1/namespaces/p0rt1on/events?fieldSelector=" +
                "involvedObject.name=it-priv,reason=FailedCreate",
            );
            const body = await events.json() as {
              items?: { message?: string }[];
            };
            return body.items?.[0]?.message ?? null;
          },
          30,
          1000,
        );
        expect(rejection).toContain("violates PodSecurity");

        const pod = await asManager(
          "/api/v1/namespaces/p0rt1on/pods/it-priv-0",
        );
        expect(pod.status).toBe(404);
        await pod.body?.cancel();
      } finally {
        const del = await asManager(
          "/apis/apps/v1/namespaces/p0rt1on/statefulsets/it-priv",
          { method: "DELETE" },
        ).catch(() => null);
        await del?.body?.cancel();
      }
    },
  );
});

import { beforeAll, describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { requireConfig, until } from "../helpers.ts";

// Black-box, as the p0rt1on-manager ServiceAccount against a real k8s API:
// the shipped Role contains it, and PSA `restricted` refuses privileged pods
// even from a compromised manager.
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
    // Cross-namespace secret read → 403 (namespace-scoped Role).
    const crossNs = await asManager("/api/v1/namespaces/kube-system/secrets");
    expect(crossNs.status).toBe(403);
    await crossNs.body?.cancel();

    // Self-escalation (editing its own Role) → 403 (no RBAC verbs).
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

    // Cluster-scoped listing (nodes) → 403.
    const nodes = await asManager("/api/v1/nodes");
    expect(nodes.status).toBe(403);
    await nodes.body?.cancel();

    // The leak-check contract: `get` on named PVCs is allowed, `list` is not.
    const list = await asManager(
      "/api/v1/namespaces/p0rt1on/persistentvolumeclaims",
    );
    expect(list.status).toBe(403);
    await list.body?.cancel();
  });

  it(
    "PSA restricted rejects a privileged pod in the namespace",
    async () => {
      // The Role can't create pods, so rejection is proven through a
      // StatefulSet it can create: admitted, but its pod never appears.
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
        // Positive evidence: the FailedCreate event names the violation.
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

        // ...and the pod never materialised.
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

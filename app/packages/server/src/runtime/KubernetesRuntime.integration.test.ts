import { describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { KubernetesRuntime } from "./KubernetesRuntime.ts";
import type { FetchLike } from "../tailscale/TailscaleHttpApi.ts";
import type { InstanceSpec } from "./runtime.ts";

// Drives a REAL k8s API server (k3d/kind), authenticated as the
// p0rt1on-manager ServiceAccount — so this proves both the API mechanics a
// fake can't (server-side apply adopt, merge-patch field removal, PSA
// admission) AND that the least-privilege Role actually suffices / contains.
// Driver: deploy/k8s/run-integration.sh (creates the cluster, applies the
// manifests, mints the SA token, imports a stub instance image). Skipped
// unless P0RT1ON_INTEGRATION + K8S_IT_* are set. No secrets needed — the
// stub image satisfies the readiness probe without a tailnet.
describe("KubernetesRuntime (integration: real k8s API)", () => {
  const server = Deno.env.get("K8S_IT_SERVER");
  const token = Deno.env.get("K8S_IT_TOKEN");
  const caFile = Deno.env.get("K8S_IT_CA");
  const image = Deno.env.get("K8S_IT_IMAGE") ?? "p0rt1on-it-stub:it";
  const enabled = Boolean(Deno.env.get("P0RT1ON_INTEGRATION")) &&
    Boolean(server && token && caFile);
  const maybe = enabled ? it : it.ignore;

  // Deno's fetch trusts the cluster CA via an explicit HTTP client.
  const fetchWithCa = (): FetchLike => {
    const client = Deno.createHttpClient({
      caCerts: [Deno.readTextFileSync(caFile ?? "")],
    });
    return (input, init) =>
      fetch(input, { ...init, client } as RequestInit & { client: unknown });
  };

  const build = () =>
    new KubernetesRuntime(
      {
        namespace: "p0rt1on",
        token: token ?? "",
        apiBase: server,
        dataSize: "10Mi",
        stateSize: "10Mi",
      },
      fetchWithCa(),
    );

  const spec: InstanceSpec = {
    name: "it-alice",
    image,
    tag: "tag:p0rt1on-serve",
    minioPort: 9100,
    rootCred: { accessKeyId: "AKIAIT", secretKey: "it-secret-123" },
    tsAuthKey: "tskey-it-fake",
  };

  maybe(
    "full lifecycle: apply → ready → key erased → scale → gated teardown",
    async () => {
      const rt = build();
      try {
        // Idempotent create-or-adopt: applying twice must not error.
        await rt.ensureInstance(spec);
        await rt.ensureInstance(spec);

        // PSA `restricted` is enforced on the namespace — the pod being
        // ADMITTED at all proves our generated pod spec satisfies it, and
        // readiness proves the stub probe runs.
        await rt.waitUntilHealthy(spec.name);
        expect(await rt.instanceHealth(spec.name)).toBe("healthy");

        // waitUntilHealthy must have erased the spent enrollment key.
        const secret = await rt["get"](
          `/api/v1/namespaces/p0rt1on/secrets/it-alice-creds`,
        ) as { data?: Record<string, string> };
        expect(secret.data?.TAILSCALE_AUTHKEY).toBeUndefined();
        expect(secret.data?.MINIO_ROOT_USER).toBeDefined();

        expect(await rt.listInstances()).toContainEqual({
          name: "it-alice",
          state: "running",
        });

        // Suspend = scale to 0; resume brings it back.
        await rt.stopInstance(spec.name);
        expect(await rt.listInstances()).toContainEqual({
          name: "it-alice",
          state: "stopped",
        });
        await rt.ensureRunning(spec.name);
        await rt.waitUntilHealthy(spec.name);

        // Teardown WITHOUT removeData keeps the PVCs (tombstone gating).
        await rt.removeInstance(spec.name, { removeData: false });
        const pvc = await rt["get"](
          `/api/v1/namespaces/p0rt1on/persistentvolumeclaims/it-alice-data`,
        );
        expect(pvc).not.toBeNull();
      } finally {
        // Full teardown; idempotent — "already absent" is success.
        await build().removeInstance(spec.name, { removeData: true });
        await build().removeInstance(spec.name, { removeData: true });
      }
    },
  );

  maybe("the manager ServiceAccount is contained by its Role", async () => {
    const raw = fetchWithCa();
    const asManager = (path: string, init?: RequestInit) =>
      raw(`${server}${path}`, {
        ...init,
        headers: {
          Authorization: `Bearer ${token}`,
          ...(init?.headers ?? {}),
        },
      });

    // Cross-namespace secret read → 403 (namespace-scoped Role).
    const crossNs = await asManager(
      "/api/v1/namespaces/kube-system/secrets",
    );
    expect(crossNs.status).toBe(403);

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

    // Cluster-scoped listing (nodes) → 403.
    const nodes = await asManager("/api/v1/nodes");
    expect(nodes.status).toBe(403);
  });

  maybe(
    "PSA restricted rejects a privileged pod in the namespace",
    async () => {
      // The manager Role has no pod-create verb, so this must be proven with
      // the pod ADMISSION error shape: create via a StatefulSet the manager
      // CAN make, with a privileged template — the STS is accepted but the
      // pod is rejected by PSA, visible as replicas never materialising.
      const raw = fetchWithCa();
      const res = await raw(
        `${server}/apis/apps/v1/namespaces/p0rt1on/statefulsets/it-priv?fieldManager=p0rt1on&force=true`,
        {
          method: "PATCH",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/apply-patch+yaml",
          },
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
        // The STS may be admitted or warned-and-admitted; what matters is the
        // pod: give the controller a moment, then assert no pod exists.
        expect(res.status).toBeLessThan(500);
        await new Promise((r) => setTimeout(r, 3000));
        const pod = await raw(
          `${server}/api/v1/namespaces/p0rt1on/pods/it-priv-0`,
          { headers: { Authorization: `Bearer ${token}` } },
        );
        expect(pod.status).toBe(404); // PSA refused to admit the pod
      } finally {
        await raw(
          `${server}/apis/apps/v1/namespaces/p0rt1on/statefulsets/it-priv`,
          {
            method: "DELETE",
            headers: { Authorization: `Bearer ${token}` },
          },
        );
      }
    },
  );
});

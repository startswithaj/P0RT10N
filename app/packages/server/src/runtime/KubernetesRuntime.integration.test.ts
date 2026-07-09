import { describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { buildRestClient, KubernetesRuntime } from "./KubernetesRuntime.ts";
import { CoreV1Api } from "@cloudydeno/kubernetes-apis/core/v1";
import type { FetchLike } from "../tailscale/TailscaleHttpApi.ts";
import type { InstanceSpec } from "./runtime.ts";

// Drives a REAL k8s API server (k3d/kind), authenticated as the
// p0rt1on-manager ServiceAccount — so this proves both the API mechanics a
// fake can't (server-side apply adopt, scale, PSA admission) AND that the
// least-privilege Role actually suffices / contains.
// Driver: deploy/k8s/run-integration.sh (creates the cluster, applies the
// manifests, mints the SA token + a headscale preauth key, imports the REAL
// instance image — readiness means tailscaled actually enrolled). Skipped
// unless P0RT1ON_INTEGRATION + K8S_IT_* are set. No secrets needed — the
// tailnet is the local headscale.
describe("KubernetesRuntime (integration: real k8s API)", () => {
  const server = Deno.env.get("K8S_IT_SERVER");
  const token = Deno.env.get("K8S_IT_TOKEN");
  const caFile = Deno.env.get("K8S_IT_CA");
  const image = Deno.env.get("K8S_IT_IMAGE") ?? "p0rt1on-instance:it";
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

  const restClient = () =>
    buildRestClient({
      apiBase: server,
      token,
      caCert: Deno.readTextFileSync(caFile ?? ""),
    });

  // A test-owned typed client to inspect real cluster state directly (the
  // runtime abstracts Secrets/PVCs away). Same lib the runtime uses — no
  // hand-built URLs.
  const readApi = async () =>
    new CoreV1Api(await restClient()).namespace("p0rt1on");

  const build = async () =>
    new KubernetesRuntime(
      {
        namespace: "p0rt1on",
        dataSize: "10Mi",
        stateSize: "10Mi",
        // Real image enrolls against the local headscale; no certs there,
        // so serve runs in HTTP mode.
        tailscale: {
          loginServer: Deno.env.get("K8S_IT_LOGIN_SERVER") ??
            "http://headscale.p0rt1on.svc:8080",
          serveMode: "http",
        },
      },
      await restClient(),
    );

  const spec: InstanceSpec = {
    name: "it-alice",
    image,
    // Tier-1-only tag: this node must never satisfy the portion tier's
    // tag:p0rt1on-serve assertions.
    tag: "tag:p0rt1on-it-tier1",
    minioPort: 9100,
    rootCred: { accessKeyId: "AKIAIT", secretKey: "it-secret-123" },
    // A REAL single-use headscale key, minted by the driver — readiness
    // requires actually redeeming it.
    tsAuthKey: Deno.env.get("K8S_IT_AUTHKEY") ?? "tskey-it-fake",
  };

  maybe(
    "full lifecycle: apply → ready → scale → gated teardown",
    async () => {
      const rt = await build();
      try {
        // Idempotent create-or-adopt: applying twice must not error.
        await rt.ensureInstance(spec);
        await rt.ensureInstance(spec);

        // PSA `restricted` is enforced on the namespace — the pod being
        // ADMITTED at all proves our generated pod spec satisfies it, and
        // readiness proves the REAL image came up: tailscaled (non-root,
        // userspace) enrolled on the tailnet and MinIO is live.
        await rt.waitUntilHealthy(spec.name);
        expect(await rt.instanceHealth(spec.name)).toBe("healthy");

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
        const pvc = await (await readApi())
          .getPersistentVolumeClaim("it-alice-data")
          .catch(() => null);
        expect(pvc).not.toBeNull();
      } finally {
        // Full teardown; idempotent — "already absent" is success.
        await (await build()).removeInstance(spec.name, { removeData: true });
        await (await build()).removeInstance(spec.name, { removeData: true });
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

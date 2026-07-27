import { beforeAll, describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import {
  buildRestClient,
  KubernetesRuntime,
} from "../../app/packages/server/src/runtime/KubernetesRuntime.ts";
import { CoreV1Api } from "@cloudydeno/kubernetes-apis/core/v1";
import type { FetchLike } from "../../app/packages/server/src/tailscale/TailscaleHttpApi.ts";
import type { InstanceSpec } from "../../app/packages/server/src/runtime/runtime.ts";
import {
  DEFAULT_HEADSCALE_URL,
  DEFAULT_INSTANCE_IMAGE,
  requireConfig,
  until,
} from "../helpers.ts";

// Drives a real k8s API server (k3d) as the p0rt1on-manager ServiceAccount:
// server-side apply, scale, PSA admission, and proof the least-privilege Role
// both suffices and contains. Run via integration-tests/k8s/run.sh — it
// creates the cluster, mints the SA token + headscale preauth key, and
// imports the real instance image. Missing config fails, never skips.
describe("KubernetesRuntime (integration: real k8s API)", () => {
  const server = Deno.env.get("K8S_INTEGRATIONTEST_SERVER");
  const token = Deno.env.get("K8S_INTEGRATIONTEST_TOKEN");
  const caFile = Deno.env.get("K8S_INTEGRATIONTEST_CA");
  const image = Deno.env.get("K8S_INTEGRATIONTEST_IMAGE") ??
    DEFAULT_INSTANCE_IMAGE;
  beforeAll(() =>
    requireConfig({
      env: [
        "K8S_INTEGRATIONTEST_SERVER",
        "K8S_INTEGRATIONTEST_TOKEN",
        "K8S_INTEGRATIONTEST_CA",
      ],
      hint: "run via ./integration-tests/k8s/run.sh tier1 (it derives them " +
        "from the k3d cluster).",
    })
  );

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

  // Test-owned typed client for inspecting state the runtime abstracts away
  // (Secrets, PVCs). Same lib the runtime uses — no hand-built URLs.
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
          loginServer: Deno.env.get("K8S_INTEGRATIONTEST_LOGIN_SERVER") ??
            DEFAULT_HEADSCALE_URL,
          serveMode: "http",
        },
        // Small requests + generous limits (won't OOM the real MinIO image).
        resources: {
          cpuRequest: "50m",
          cpuLimit: "1",
          memoryRequest: "64Mi",
          memoryLimit: "1Gi",
        },
        pantryStorageClass: "p0rt1on-pantry",
      },
      await restClient(),
    );

  const spec: InstanceSpec = {
    name: "integrationtest-alice",
    image,
    // Tier-1-only tag: this node must never satisfy the portion tier's
    // tag:p0rt1on-serve assertions.
    tag: "tag:p0rt1on-integrationtest-tier1",
    minioPort: 9100,
    rootCred: {
      accessKeyId: "AKIAINTEGRATIONTEST",
      secretKey: "integrationtest-secret-123",
    },
    // A REAL single-use headscale key, minted by the driver — readiness
    // requires actually redeeming it.
    tsAuthKey: Deno.env.get("K8S_INTEGRATIONTEST_AUTHKEY") ??
      "tskey-integrationtest-fake",
  };

  it(
    "full lifecycle: apply → ready → scale → gated teardown",
    async () => {
      const rt = await build();
      try {
        // Idempotent create-or-adopt: applying twice must not error.
        await rt.ensureInstance(spec);
        await rt.ensureInstance(spec);

        // Admission proves the generated pod spec satisfies PSA `restricted`;
        // readiness proves the real image came up (tailscaled enrolled, MinIO
        // live).
        await rt.waitUntilHealthy(spec.name);
        expect(await rt.instanceHealth(spec.name)).toBe("healthy");

        // The configured CPU/memory actually landed on the pod container.
        const podRes =
          (await (await readApi()).getPod("integrationtest-alice-0"))
            .spec?.containers?.[0].resources;
        expect(podRes?.requests?.cpu?.serialize()).toBe("50m");
        expect(podRes?.requests?.memory?.serialize()).toBe("64Mi");
        expect(podRes?.limits?.cpu?.serialize()).toBe("1");
        expect(podRes?.limits?.memory?.serialize()).toBe("1Gi");

        expect(await rt.listInstances()).toContainEqual({
          name: "integrationtest-alice",
          state: "running",
        });

        // Suspend = scale to 0; resume brings it back.
        await rt.stopInstance(spec.name);
        expect(await rt.listInstances()).toContainEqual({
          name: "integrationtest-alice",
          state: "stopped",
        });
        await rt.ensureRunning(spec.name);
        await rt.waitUntilHealthy(spec.name);

        // Teardown WITHOUT removeData keeps the PVCs (tombstone gating).
        await rt.removeInstance(spec.name, { removeData: false });
        const pvc = await (await readApi())
          .getPersistentVolumeClaim("integrationtest-alice-data")
          .catch(() => null);
        expect(pvc).not.toBeNull();
      } finally {
        // Full teardown; idempotent — "already absent" is success.
        await (await build()).removeInstance(spec.name, { removeData: true });
        await (await build()).removeInstance(spec.name, { removeData: true });
      }
    },
  );

  it("the manager ServiceAccount is contained by its Role", async () => {
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

  it(
    "PSA restricted rejects a privileged pod in the namespace",
    async () => {
      // The Role can't create pods, so PSA rejection is proven via a
      // StatefulSet the manager CAN create: the STS is admitted, but its
      // privileged pod never materialises.
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
        expect(res.status).toBeLessThan(500);

        // Positive evidence, not absence-after-a-sleep: the controller's
        // FailedCreate event names the PodSecurity violation.
        const rejection = await until(
          "PSA FailedCreate event",
          async () => {
            const events = await raw(
              `${server}/api/v1/namespaces/p0rt1on/events?fieldSelector=` +
                "involvedObject.name=it-priv,reason=FailedCreate",
              { headers: { Authorization: `Bearer ${token}` } },
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
        const pod = await raw(
          `${server}/api/v1/namespaces/p0rt1on/pods/it-priv-0`,
          { headers: { Authorization: `Bearer ${token}` } },
        );
        expect(pod.status).toBe(404);
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

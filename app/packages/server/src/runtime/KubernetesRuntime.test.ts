import { describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { KubernetesRuntime } from "./KubernetesRuntime.ts";
import {
  fakeFetch,
  INSTANCE_SPEC,
  type RecordedRequest,
} from "../test-helpers/mocks.ts";

describe("KubernetesRuntime", () => {
  const build = (
    reqs: RecordedRequest[],
    handler: Parameters<typeof fakeFetch>[1] = () => ({ json: {} }),
  ) =>
    new KubernetesRuntime(
      {
        namespace: "p0rt1on",
        token: "sa-token",
        apiBase: "https://k8s.test",
        dataSize: "50Gi",
        stateSize: "1Gi",
      },
      fakeFetch(reqs, handler),
    );

  const readyPod = {
    status: {
      phase: "Running",
      containerStatuses: [{ ready: true, restartCount: 0, state: {} }],
    },
  };

  it("ensureInstance applies PVCs, Secret, Service, StatefulSet — all labelled", async () => {
    const reqs: RecordedRequest[] = [];
    const handle = await build(reqs).ensureInstance(INSTANCE_SPEC);

    expect(handle).toEqual({ name: "alice", id: "alice", state: "running" });
    // Server-side apply everywhere: create-or-adopt, idempotent on retry.
    const applied = reqs.map((r) => r.url.split("?")[0].split("/").at(-1));
    expect(applied).toEqual([
      "alice-data",
      "alice-state",
      "alice-creds",
      "alice",
      "alice",
    ]);
    reqs.forEach((r) => {
      expect(r.method).toBe("PATCH");
      expect(r.url).toContain("fieldManager=p0rt1on");
      expect(r.headers["content-type"]).toBe("application/apply-patch+yaml");
      expect(r.headers["authorization"]).toBe("Bearer sa-token");
      const manifest = JSON.parse(r.body ?? "{}");
      expect(manifest.metadata.labels["app.kubernetes.io/managed-by"])
        .toBe("p0rt1on");
    });
  });

  it("the pod spec is restricted-profile clean and API-credential free", async () => {
    const reqs: RecordedRequest[] = [];
    await build(reqs).ensureInstance(INSTANCE_SPEC);
    const sts = JSON.parse(
      reqs.find((r) => r.url.includes("/statefulsets/"))?.body ?? "{}",
    );
    const pod = sts.spec.template.spec;
    // Least privilege: no API token, no capabilities, userspace tailscaled.
    expect(pod.automountServiceAccountToken).toBe(false);
    expect(pod.securityContext).toEqual({
      runAsNonRoot: true,
      runAsUser: 1000,
      runAsGroup: 1000,
      fsGroup: 1000,
      seccompProfile: { type: "RuntimeDefault" },
    });
    expect(pod.containers[0].securityContext).toEqual({
      allowPrivilegeEscalation: false,
      capabilities: { drop: ["ALL"] },
    });
    const env = Object.fromEntries(
      pod.containers[0].env.map((e: { name: string; value: string }) => [
        e.name,
        e.value,
      ]),
    );
    expect(env.TS_USERSPACE).toBe("true");
    expect(env.TAILSCALE_HOSTNAME).toBe("alice");
    expect(env.MINIO_PORT).toBe("9100");
    // Secrets ride the Secret (envFrom), never plain env.
    expect(JSON.stringify(pod.containers[0].env)).not.toContain("secret123");
    expect(pod.containers[0].envFrom).toEqual([
      { secretRef: { name: "alice-creds" } },
    ]);
    expect(pod.containers[0].readinessProbe.exec.command).toEqual([
      "/healthcheck.sh",
    ]);
  });

  it("tailscale extras land in the pod env only when configured", async () => {
    // Default build (no tailscale config): neither var appears.
    const plainReqs: RecordedRequest[] = [];
    await build(plainReqs).ensureInstance(INSTANCE_SPEC);
    const plainSts = plainReqs.find((r) => r.url.includes("/statefulsets/"));
    expect(plainSts?.body).not.toContain("TAILSCALE_LOGIN_SERVER");
    expect(plainSts?.body).not.toContain("TAILSCALE_SERVE_MODE");

    // Headscale test tier: login server + the no-cert http serve fallback.
    const reqs: RecordedRequest[] = [];
    const headscale = new KubernetesRuntime(
      {
        namespace: "p0rt1on",
        token: "sa-token",
        apiBase: "https://k8s.test",
        dataSize: "50Gi",
        stateSize: "1Gi",
        tailscale: { loginServer: "http://hs:8080", serveMode: "http" },
      },
      fakeFetch(reqs, () => ({ json: {} })),
    );
    await headscale.ensureInstance(INSTANCE_SPEC);
    const sts = JSON.parse(
      reqs.find((r) => r.url.includes("/statefulsets/"))?.body ?? "{}",
    );
    const env = Object.fromEntries(
      sts.spec.template.spec.containers[0].env.map(
        (e: { name: string; value: string }) => [e.name, e.value],
      ),
    );
    expect(env.TAILSCALE_LOGIN_SERVER).toBe("http://hs:8080");
    expect(env.TAILSCALE_SERVE_MODE).toBe("http");
  });

  it("a failed Secret apply never echoes the secret material", async () => {
    const failing = build(
      [],
      (req) =>
        req.url.includes("/secrets/")
          ? { status: 500, json: { message: "boom secret123 tskey" } }
          : { json: {} },
    );
    const err = await failing.ensureInstance(INSTANCE_SPEC)
      .then(() => null, (e: Error) => e.message);
    expect(err).toContain("failed (500)");
    expect(err).not.toContain("secret123");
    expect(err).not.toContain("tskey");
  });

  it("adminEndpoint addresses the per-instance Service via cluster DNS", () => {
    expect(build([]).adminEndpoint("alice", 9100))
      .toBe("http://alice.p0rt1on.svc:9100");
  });

  it("waitUntilHealthy erases the spent enrollment key from the Secret", async () => {
    const reqs: RecordedRequest[] = [];
    await build(
      reqs,
      (req) => req.url.includes("/pods/") ? { json: readyPod } : { json: {} },
    )
      .waitUntilHealthy("alice");

    const patch = reqs.find((r) => r.url.includes("/secrets/alice-creds"));
    expect(patch?.method).toBe("PATCH");
    expect(patch?.headers["content-type"]).toBe("application/merge-patch+json");
    // JSON merge-patch null = remove the field.
    expect(JSON.parse(patch?.body ?? "{}")).toEqual({
      data: { TAILSCALE_AUTHKEY: null },
    });
  });

  it("instanceHealth maps pod readiness / crashloop / absence", async () => {
    const healthy = build([], () => ({ json: readyPod }));
    expect(await healthy.instanceHealth("alice")).toBe("healthy");

    const crashing = build([], () => ({
      json: {
        status: {
          phase: "Running",
          containerStatuses: [{
            ready: false,
            state: { waiting: { reason: "CrashLoopBackOff" } },
          }],
        },
      },
    }));
    expect(await crashing.instanceHealth("alice")).toBe("unhealthy");

    const pending = build([], () => ({
      json: { status: { phase: "Pending" } },
    }));
    expect(await pending.instanceHealth("alice")).toBe("starting");

    const absent = build([], () => ({ status: 404, json: {} }));
    expect(await absent.instanceHealth("alice")).toBe("unknown");
  });

  it("listInstances maps label-selected StatefulSets; replicas 0 = stopped", async () => {
    const reqs: RecordedRequest[] = [];
    const list = await build(reqs, () => ({
      json: {
        items: [
          { metadata: { name: "alice" }, spec: { replicas: 1 } },
          { metadata: { name: "pool" }, spec: { replicas: 0 } },
        ],
      },
    })).listInstances();

    expect(reqs[0].url).toContain(
      "labelSelector=app.kubernetes.io%2Fmanaged-by%3Dp0rt1on",
    );
    expect(list).toEqual([
      { name: "alice", state: "running" },
      { name: "pool", state: "stopped" },
    ]);
  });

  it("stop/ensureRunning scale replicas; absent adopt throws", async () => {
    const reqs: RecordedRequest[] = [];
    const rt = build(reqs, () => ({ json: {} }));
    await rt.stopInstance("alice");
    await rt.ensureRunning("alice");
    const patches = reqs.filter((r) => r.method === "PATCH");
    expect(JSON.parse(patches[0].body ?? "{}")).toEqual({
      spec: { replicas: 0 },
    });
    expect(JSON.parse(patches[1].body ?? "{}")).toEqual({
      spec: { replicas: 1 },
    });

    const gone = build([], () => ({ status: 404, json: {} }));
    // stop tolerates absence (idempotent teardown); adopt never invents.
    await gone.stopInstance("alice");
    await expect(gone.ensureRunning("alice")).rejects.toThrow("cannot adopt");
  });

  it("removeInstance deletes workload always, PVCs only with removeData", async () => {
    const reqs: RecordedRequest[] = [];
    const rt = build(reqs, () => ({ json: {} }));
    await rt.removeInstance("alice", { removeData: false });
    const deleted = (from: number) =>
      reqs.slice(from).filter((r) => r.method === "DELETE")
        .map((r) => r.url.split("/").at(-1));
    expect(deleted(0)).toEqual(["alice", "alice", "alice-creds"]);

    const n = reqs.length;
    await rt.removeInstance("alice", { removeData: true });
    expect(deleted(n)).toEqual([
      "alice",
      "alice",
      "alice-creds",
      "alice-data",
      "alice-state",
    ]);

    // Idempotent: everything already absent is success.
    const gone = build([], () => ({ status: 404, json: {} }));
    await gone.removeInstance("alice", { removeData: true });
  });

  it("diagnoseInstance assembles pod state + reason + log tail", async () => {
    const rt = build([], (req) => {
      if (req.url.endsWith("/log?tailLines=50")) {
        return { json: undefined, status: 200 };
      }
      return {
        json: {
          status: {
            phase: "Pending",
            containerStatuses: [{
              ready: false,
              state: { waiting: { reason: "ImagePullBackOff" } },
            }],
          },
        },
      };
    });
    const d = await rt.diagnoseInstance("alice");
    expect(d.name).toBe("alice-0");
    expect(d.state).toBe("stopped");
    expect(d.health).toBe("starting");
    expect(d.healthReason).toBe("ImagePullBackOff");
  });
});

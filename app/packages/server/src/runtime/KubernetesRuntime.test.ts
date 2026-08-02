import { describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { KubernetesRuntime } from "./KubernetesRuntime.ts";
import { INSTANCE_SPEC } from "../test-helpers/mocks.ts";
import type { RestClient } from "@cloudydeno/kubernetes-client";

// Tests mock `RestClient.performRequest`, the cloudydeno api layer's entry
// point, asserting on its structured requests instead of raw URL strings.
interface Recorded {
  method: string;
  path: string;
  query: string;
  contentType?: string;
  body?: unknown;
}

type Reply = { json?: unknown; status?: number };

describe("KubernetesRuntime", () => {
  const fakeClient = (
    recorded: Recorded[],
    handler: (r: Recorded) => Reply = () => ({}),
  ): RestClient => {
    // deno-lint-ignore no-explicit-any
    const perform = (opts: any): Promise<unknown> => {
      const rec: Recorded = {
        method: opts.method,
        path: opts.path,
        query: String(opts.querystring ?? ""),
        contentType: opts.contentType,
        body: opts.bodyJson,
      };
      recorded.push(rec);
      const reply = handler(rec);
      if (reply.status && reply.status >= 400) {
        // Mirrors cloudydeno by attaching `httpCode` and echoing the response
        // message, never the request, so the test can prove redaction works.
        const err = new Error(
          `Kubernetes returned HTTP ${reply.status}: ${
            (reply.json as { message?: string })?.message ?? ""
          }`,
        );
        (err as { httpCode?: number }).httpCode = reply.status;
        return Promise.reject(err);
      }
      if (opts.expectJson) return Promise.resolve(reply.json ?? {});
      return Promise.resolve(
        new TextEncoder().encode(
          typeof reply.json === "string" ? reply.json : "",
        ),
      );
    };

    return {
      performRequest: perform,
      close() {},
      [Symbol.dispose]() {},
    } as unknown as RestClient;
  };

  const build = (
    recorded: Recorded[],
    handler?: (r: Recorded) => Reply,
    tailscale?: { loginServer?: string; serveMode: "https" | "http" },
  ) =>
    new KubernetesRuntime(
      {
        namespace: "p0rt1on",
        dataSize: "50Gi",
        stateSize: "1Gi",
        pantryStorageClass: "p0rt1on-pantry",
        tailscale,
      },
      fakeClient(recorded, handler),
    );

  // cloudydeno's converters are strict about required fields (e.g.
  // ContainerStatus needs imageID) even when tests never read them.
  const cstatus = (over: Record<string, unknown>) => ({
    name: "instance",
    image: "img",
    imageID: "img@sha",
    ready: false,
    restartCount: 0,
    ...over,
  });

  const pod = (phase: string, cs?: Record<string, unknown>) => ({
    status: {
      phase,
      ...(cs ? { containerStatuses: [cstatus(cs)] } : {}),
    },
  });

  const readyPod = pod("Running", { ready: true, state: {} });

  const sts = (name: string, replicas: number) => ({
    metadata: { name },
    spec: {
      replicas,
      serviceName: name,
      selector: { matchLabels: {} },
      template: {
        metadata: {},
        spec: { containers: [{ name: "instance", image: "img" }] },
      },
    },
  });

  const last = (path: string) => path.split("/").at(-1);

  const bodyOf = (reqs: Recorded[], kind: string) =>
    reqs.find((r) => r.path.includes(`/${kind}/`))?.body as // deno-lint-ignore no-explicit-any
    any;

  it("ensureInstance applies PVCs, Secret, Service, StatefulSet — all labelled", async () => {
    const reqs: Recorded[] = [];
    const handle = await build(reqs).ensureInstance(INSTANCE_SPEC);

    expect(handle).toEqual({ name: "alice", id: "alice", state: "running" });
    // Server-side apply everywhere: create-or-adopt, idempotent on retry.
    expect(reqs.map((r) => last(r.path))).toEqual([
      "alice-data",
      "alice-state",
      "alice-creds",
      "alice",
      "alice",
    ]);
    reqs.forEach((r) => {
      expect(r.method).toBe("PATCH");
      expect(r.query).toContain("fieldManager=p0rt1on");
      expect(r.query).toContain("force=1"); // cloudydeno serializes true as 1
      expect(r.contentType).toBe("application/apply-patch+yaml");
      // deno-lint-ignore no-explicit-any
      const manifest = r.body as any;
      expect(manifest.metadata.labels["app.kubernetes.io/managed-by"])
        .toBe("p0rt1on");
    });
  });

  it("data PVC uses the pantry class; state PVC uses the cluster default", async () => {
    const reqs: Recorded[] = [];
    await build(reqs).ensureInstance(INSTANCE_SPEC);
    const data = reqs.find((r) => last(r.path) === "alice-data")
      ?.body as { spec: { storageClassName?: string } };
    const state = reqs.find((r) => last(r.path) === "alice-state")
      ?.body as { spec: { storageClassName?: string } };
    expect(data.spec.storageClassName).toBe("p0rt1on-pantry");
    expect(state.spec.storageClassName).toBeUndefined();
  });

  it("pins the PVC retention policy so suspend never deletes data", async () => {
    const reqs: Recorded[] = [];
    await build(reqs).ensureInstance(INSTANCE_SPEC);
    // Scale-to-0 (suspend) and StatefulSet delete must both keep the PVCs.
    expect(
      bodyOf(reqs, "statefulsets").spec.persistentVolumeClaimRetentionPolicy,
    )
      .toEqual({ whenScaled: "Retain", whenDeleted: "Retain" });
  });

  it("hasData is true when the data PVC exists, false on 404", async () => {
    const present = build(
      [],
      (r) =>
        r.path.includes("persistentvolumeclaims")
          ? { json: { metadata: { name: "alice-data" } } }
          : {},
    );
    expect(await present.hasData("alice")).toBe(true);

    const gone = build(
      [],
      (r) => r.path.includes("persistentvolumeclaims") ? { status: 404 } : {},
    );
    expect(await gone.hasData("alice")).toBe(false);
  });

  it("the pod spec is restricted-profile clean and API-credential free", async () => {
    const reqs: Recorded[] = [];
    await build(reqs).ensureInstance(INSTANCE_SPEC);
    const pod = bodyOf(reqs, "statefulsets").spec.template.spec;
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
    const plainReqs: Recorded[] = [];
    await build(plainReqs).ensureInstance(INSTANCE_SPEC);
    const plainEnv = bodyOf(plainReqs, "statefulsets")
      .spec.template.spec.containers[0].env
      .map((e: { name: string }) => e.name);
    expect(plainEnv).not.toContain("TAILSCALE_LOGIN_SERVER");
    expect(plainEnv).not.toContain("TAILSCALE_SERVE_MODE");

    // Headscale test tier lacks TLS certs, hence the http serve-mode fallback.
    const reqs: Recorded[] = [];
    await build(reqs, undefined, {
      loginServer: "http://hs:8080",
      serveMode: "http",
    }).ensureInstance(INSTANCE_SPEC);
    const env = Object.fromEntries(
      bodyOf(reqs, "statefulsets").spec.template.spec.containers[0].env
        .map((e: { name: string; value: string }) => [e.name, e.value]),
    );
    expect(env.TAILSCALE_LOGIN_SERVER).toBe("http://hs:8080");
    expect(env.TAILSCALE_SERVE_MODE).toBe("http");
  });

  it("container resources: omitted by default, set from config", async () => {
    const plain: Recorded[] = [];
    await build(plain).ensureInstance(INSTANCE_SPEC);
    expect(bodyOf(plain, "statefulsets").spec.template.spec.containers[0])
      .not.toHaveProperty("resources");

    const reqs: Recorded[] = [];
    await new KubernetesRuntime(
      {
        namespace: "p0rt1on",
        dataSize: "50Gi",
        stateSize: "1Gi",
        pantryStorageClass: "p0rt1on-pantry",
        resources: {
          cpuRequest: "250m",
          cpuLimit: "1",
          memoryRequest: "256Mi",
          memoryLimit: "1Gi",
        },
      },
      fakeClient(reqs),
    ).ensureInstance(INSTANCE_SPEC);
    expect(
      bodyOf(reqs, "statefulsets").spec.template.spec.containers[0].resources,
    )
      .toEqual({
        requests: { cpu: "250m", memory: "256Mi" },
        limits: { cpu: "1", memory: "1Gi" },
      });
  });

  it("a failed Secret apply never echoes the secret material", async () => {
    const failing = build(
      [],
      (r) =>
        r.path.includes("/secrets/")
          ? { status: 500, json: { message: "boom secret123 tskey" } }
          : {},
    );
    const err = await failing.ensureInstance(INSTANCE_SPEC)
      .then(() => null, (e: Error) => e.message);
    expect(err).toContain("redacted");
    expect(err).not.toContain("secret123");
    expect(err).not.toContain("tskey");
  });

  it("adminEndpoint addresses the per-instance Service via cluster DNS", () => {
    expect(build([]).adminEndpoint("alice", 9100))
      .toBe("http://alice.p0rt1on.svc:9100");
  });

  it("instanceHealth maps pod readiness / crashloop / absence", async () => {
    const healthy = build([], () => ({ json: readyPod }));
    expect(await healthy.instanceHealth("alice")).toBe("healthy");

    const crashing = build([], () => ({
      json: pod("Running", {
        ready: false,
        state: { waiting: { reason: "CrashLoopBackOff" } },
      }),
    }));
    expect(await crashing.instanceHealth("alice")).toBe("unhealthy");

    const pending = build([], () => ({ json: pod("Pending") }));
    expect(await pending.instanceHealth("alice")).toBe("starting");

    const absent = build([], () => ({ status: 404 }));
    expect(await absent.instanceHealth("alice")).toBe("unknown");
  });

  it("listInstances maps label-selected StatefulSets; replicas 0 = stopped", async () => {
    const reqs: Recorded[] = [];
    const list = await build(reqs, () => ({
      json: { metadata: {}, items: [sts("alice", 1), sts("pool", 0)] },
    })).listInstances();

    expect(reqs[0].query).toContain(
      "labelSelector=app.kubernetes.io%2Fmanaged-by%3Dp0rt1on",
    );
    expect(list).toEqual([
      { name: "alice", state: "running" },
      { name: "pool", state: "stopped" },
    ]);
  });

  it("stop/ensureRunning scale replicas; absent adopt throws", async () => {
    const reqs: Recorded[] = [];
    const rt = build(reqs, () => ({ json: {} }));
    await rt.stopInstance("alice");
    await rt.ensureRunning("alice");
    // Scale = json-patch replace on the MAIN resource (no /scale subresource).
    const scales = reqs.filter((r) =>
      r.contentType === "application/json-patch+json"
    );
    expect(scales[0].body).toEqual([
      { op: "replace", path: "/spec/replicas", value: 0 },
    ]);
    expect(scales[1].body).toEqual([
      { op: "replace", path: "/spec/replicas", value: 1 },
    ]);

    const gone = build([], () => ({ status: 404 }));
    // stop tolerates absence (idempotent teardown); adopt never invents.
    await gone.stopInstance("alice");
    await expect(gone.ensureRunning("alice")).rejects.toThrow("cannot adopt");

    // A non-404 scale failure is a real error, so stop must not swallow it.
    const broken = build([], () => ({ status: 500 }));
    await expect(broken.stopInstance("alice")).rejects.toThrow();
  });

  it("diagnoseInstance reports absent when the pod is gone", async () => {
    const d = await build([], () => ({ status: 404 })).diagnoseInstance(
      "alice",
    );
    expect(d.state).toBe("absent");
    expect(d.health).toBe("unknown");
    expect(d.recentLogs).toBe("");
  });

  it("removeInstance deletes workload always, PVCs only with removeData", async () => {
    const reqs: Recorded[] = [];
    const rt = build(reqs, () => ({ json: {} }));
    await rt.removeInstance("alice", { removeData: false });

    const deleted = (from: number) =>
      reqs.slice(from).filter((r) => r.method === "DELETE").map((r) =>
        last(r.path)
      );

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
    const gone = build([], () => ({ status: 404 }));
    await gone.removeInstance("alice", { removeData: true });
  });

  it("diagnoseInstance assembles pod state + reason + log tail", async () => {
    const pendingPod = pod("Pending", {
      ready: false,
      state: { waiting: { reason: "ImagePullBackOff" } },
    });
    const rt = build(
      [],
      (r) => r.path.endsWith("/log") ? { json: "" } : { json: pendingPod },
    );
    const d = await rt.diagnoseInstance("alice");
    expect(d.name).toBe("alice-0");
    expect(d.state).toBe("stopped");
    expect(d.health).toBe("starting");
    expect(d.healthReason).toBe("ImagePullBackOff");
  });
});

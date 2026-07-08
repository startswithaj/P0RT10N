import type {
  ContainerHandle,
  ContainerState,
  InstanceDiagnostics,
  InstanceHealth,
  InstanceRuntime,
  InstanceSpec,
} from "./runtime.ts";
import type { FetchLike } from "../tailscale/TailscaleHttpApi.ts";
import { ServiceError } from "../lib/ServiceError.ts";

// ============================================================================
// InstanceRuntime over the Kubernetes REST API (plain fetch + ServiceAccount
// bearer token — no kubectl). One instance = StatefulSet(1 replica) + Service
// + Secret + 2 PVCs, all in ONE namespace, all labelled `p0rt1on=1`. Least
// privilege by construction: tailscaled runs userspace (TS_USERSPACE=true, no
// capabilities, no devices) so the namespace can enforce PSA `restricted`;
// instance pods never get an API token. The manager's RBAC is a single
// namespace-scoped Role. Suspend = scale to 0 (kubelet owns restarts, so
// there is no docker-style `stop`).
// ============================================================================

export interface KubeConfig {
  namespace: string;
  /** ServiceAccount bearer token (in-cluster: read from the mounted file). */
  token: string;
  /** API base; in-cluster default. TLS: point DENO_CERT at the cluster CA. */
  apiBase?: string;
  /** PVC sizes. Per-friend quota stays bucket-level (MinIO), not storage. */
  dataSize: string;
  stateSize: string;
  storageClass?: string;
}

const LABEL_KEY = "app.kubernetes.io/managed-by";
const LABEL_VALUE = "p0rt1on";
const LABEL_SELECTOR = `${LABEL_KEY}=${LABEL_VALUE}`;

/** Resource names derived from the instance name (already a DNS label). */
function resourceNames(instance: string) {
  return {
    statefulSet: instance,
    service: instance,
    secret: `${instance}-creds`,
    dataPvc: `${instance}-data`,
    statePvc: `${instance}-state`,
    pod: `${instance}-0`,
  };
}

/** Pod status subset we read for health/diagnostics. */
interface PodStatus {
  phase?: string;
  containerStatuses?: {
    ready?: boolean;
    restartCount?: number;
    state?: {
      waiting?: { reason?: string; message?: string };
      terminated?: { exitCode?: number; message?: string };
    };
  }[];
}

export class KubernetesRuntime implements InstanceRuntime {
  private readonly base: string;

  constructor(
    private readonly config: KubeConfig,
    private readonly fetchFn: FetchLike = globalThis.fetch,
  ) {
    this.base = config.apiBase ?? "https://kubernetes.default.svc";
  }

  async ensureInstance(spec: InstanceSpec): Promise<ContainerHandle> {
    const names = resourceNames(spec.name);
    // Server-side apply is create-or-adopt in one call (idempotent retries).
    // PVCs are created directly (not volumeClaimTemplates) so teardown can
    // gate their deletion exactly like docker volume deletion.
    await this.applyPvc(names.dataPvc, spec.name, this.config.dataSize);
    await this.applyPvc(names.statePvc, spec.name, this.config.stateSize);
    await this.apply(
      this.corePath("secrets", names.secret),
      this.secretFor(spec),
      // The Secret body carries the root cred + enrollment key — never let
      // an API error echo it.
      { redactBody: true },
    );
    await this.apply(
      this.corePath("services", names.service),
      this.serviceFor(spec),
    );
    await this.apply(
      this.appsPath("statefulsets", names.statefulSet),
      this.statefulSetFor(spec),
    );
    return { name: spec.name, id: names.statefulSet, state: "running" };
  }

  adminEndpoint(instanceName: string, minioPort: number): string {
    const svc = resourceNames(instanceName).service;
    return `http://${svc}.${this.config.namespace}.svc:${minioPort}`;
  }

  async waitUntilHealthy(instanceName: string): Promise<void> {
    await this.pollHealth(instanceName, 60);
    // The enrollment key is single-use and now spent (the node identity
    // lives on the state PVC) — a Secret persists in etcd, so erase the key
    // rather than leave a dead credential around forever.
    await this.request(
      "PATCH",
      this.corePath("secrets", resourceNames(instanceName).secret),
      { data: { TAILSCALE_AUTHKEY: null } },
      { contentType: "application/merge-patch+json", redactBody: true },
    );
  }

  async ensureRunning(instanceName: string): Promise<void> {
    const sts = await this.get(
      this.appsPath("statefulsets", resourceNames(instanceName).statefulSet),
    );
    if (sts === null) {
      throw new ServiceError(
        "INTERNAL_SERVER_ERROR",
        `instance ${instanceName} not found — cannot adopt an instance that does not exist`,
      );
    }
    await this.scale(instanceName, 1);
  }

  async instanceHealth(instanceName: string): Promise<InstanceHealth> {
    const pod = await this.get(
      this.corePath("pods", resourceNames(instanceName).pod),
    ) as { status?: PodStatus } | null;
    if (pod === null) return "unknown";
    const status = pod.status ?? {};
    const container = status.containerStatuses?.[0];
    if (container?.ready) return "healthy";
    const waiting = container?.state?.waiting?.reason ?? "";
    if (waiting === "CrashLoopBackOff" || container?.state?.terminated) {
      return "unhealthy";
    }
    return "starting";
  }

  async listInstances(): Promise<
    { name: string; state: ContainerState }[]
  > {
    const res = await this.request(
      "GET",
      `${this.appsPath("statefulsets", "")}?labelSelector=${
        encodeURIComponent(LABEL_SELECTOR)
      }`,
    ) as {
      items?: { metadata?: { name?: string }; spec?: { replicas?: number } }[];
    };
    return (res.items ?? [])
      .filter((i) => typeof i.metadata?.name === "string")
      .map((i) => ({
        name: i.metadata?.name as string,
        state: (i.spec?.replicas ?? 1) === 0 ? "stopped" : "running",
      }));
  }

  async stopInstance(instanceName: string): Promise<void> {
    // Suspend = scale to 0: kubelet owns restarts, so deleting the pod would
    // just resurrect it. Data + Secret stay. "Already absent" is success.
    await this.scale(instanceName, 0).catch((err) => {
      if (err instanceof ServiceError && /\(404\)/.test(err.message)) return;
      throw err;
    });
  }

  async removeInstance(
    instanceName: string,
    opts: { removeData: boolean },
  ): Promise<void> {
    const names = resourceNames(instanceName);
    await this.delete(this.appsPath("statefulsets", names.statefulSet));
    await this.delete(this.corePath("services", names.service));
    await this.delete(this.corePath("secrets", names.secret));
    if (opts.removeData) {
      // Gated exactly like docker volume deletion; with a Retain
      // StorageClass the PV additionally survives until a human confirms.
      await this.delete(
        this.corePath("persistentvolumeclaims", names.dataPvc),
      );
      await this.delete(
        this.corePath("persistentvolumeclaims", names.statePvc),
      );
    }
  }

  async diagnoseInstance(instanceName: string): Promise<InstanceDiagnostics> {
    const names = resourceNames(instanceName);
    const pod = await this.get(this.corePath("pods", names.pod)) as {
      status?: PodStatus;
    } | null;
    if (pod === null) {
      return {
        name: names.pod,
        state: "absent",
        health: "unknown",
        healthReason: null,
        exitCode: null,
        exitError: null,
        recentLogs: "",
      };
    }
    const status = pod.status ?? {};
    const container = status.containerStatuses?.[0];
    const waiting = container?.state?.waiting;
    const terminated = container?.state?.terminated;
    return {
      name: names.pod,
      state: status.phase === "Running" ? "running" : "stopped",
      health: await this.instanceHealth(instanceName),
      healthReason: waiting?.reason ?? waiting?.message ?? null,
      exitCode: terminated?.exitCode ?? null,
      exitError: terminated?.message ?? null,
      recentLogs: await this.logs(names.pod),
    };
  }

  // ---- manifest builders ----

  private meta(name: string, instance: string) {
    return {
      name,
      namespace: this.config.namespace,
      labels: { [LABEL_KEY]: LABEL_VALUE, "p0rt1on/instance": instance },
    };
  }

  private secretFor(spec: InstanceSpec) {
    return {
      apiVersion: "v1",
      kind: "Secret",
      metadata: this.meta(resourceNames(spec.name).secret, spec.name),
      stringData: {
        MINIO_ROOT_USER: spec.rootCred.accessKeyId,
        MINIO_ROOT_PASSWORD: spec.rootCred.secretKey,
        TAILSCALE_AUTHKEY: spec.tsAuthKey,
      },
    };
  }

  private pvcFor(name: string, instance: string, size: string) {
    return {
      apiVersion: "v1",
      kind: "PersistentVolumeClaim",
      metadata: this.meta(name, instance),
      spec: {
        accessModes: ["ReadWriteOnce"],
        resources: { requests: { storage: size } },
        ...(this.config.storageClass
          ? { storageClassName: this.config.storageClass }
          : {}),
      },
    };
  }

  private serviceFor(spec: InstanceSpec) {
    return {
      apiVersion: "v1",
      kind: "Service",
      metadata: this.meta(resourceNames(spec.name).service, spec.name),
      spec: {
        selector: { "p0rt1on/instance": spec.name },
        ports: [{ port: spec.minioPort, targetPort: spec.minioPort }],
      },
    };
  }

  private statefulSetFor(spec: InstanceSpec) {
    const names = resourceNames(spec.name);
    return {
      apiVersion: "apps/v1",
      kind: "StatefulSet",
      metadata: this.meta(names.statefulSet, spec.name),
      spec: {
        replicas: 1,
        serviceName: names.service,
        selector: { matchLabels: { "p0rt1on/instance": spec.name } },
        template: {
          metadata: {
            labels: {
              [LABEL_KEY]: LABEL_VALUE,
              "p0rt1on/instance": spec.name,
            },
          },
          spec: {
            // Instance pods never talk to the k8s API — a compromised
            // (friend-facing) pod must find no API credential inside.
            automountServiceAccountToken: false,
            // The full PSA `restricted` set — the namespace enforces it, so
            // omitting any of these means the pod is REJECTED, not degraded.
            // Explicit uid: the image defaults to root, and runAsNonRoot
            // alone would fail at container start; fsGroup makes the PVCs
            // writable for that uid.
            securityContext: {
              runAsNonRoot: true,
              runAsUser: 1000,
              runAsGroup: 1000,
              fsGroup: 1000,
              seccompProfile: { type: "RuntimeDefault" },
            },
            containers: [{
              name: "instance",
              image: spec.image,
              envFrom: [{ secretRef: { name: names.secret } }],
              env: [
                // Userspace tailscaled: zero capabilities, no /dev/net/tun —
                // the namespace can enforce PSA `restricted`.
                { name: "TS_USERSPACE", value: "true" },
                { name: "TAILSCALE_HOSTNAME", value: spec.name },
                { name: "TAILSCALE_TAG", value: spec.tag },
                { name: "MINIO_PORT", value: String(spec.minioPort) },
              ],
              ports: [{ containerPort: spec.minioPort }],
              // Same script as the docker HEALTHCHECK (tailscale up AND
              // MinIO live) — shared, not duplicated.
              readinessProbe: {
                exec: { command: ["/healthcheck.sh"] },
                initialDelaySeconds: 20,
                periodSeconds: 30,
                timeoutSeconds: 5,
                failureThreshold: 3,
              },
              securityContext: {
                allowPrivilegeEscalation: false,
                capabilities: { drop: ["ALL"] },
              },
              volumeMounts: [
                { name: "data", mountPath: "/data" },
                { name: "tsstate", mountPath: "/var/lib/tailscale" },
              ],
            }],
            volumes: [
              {
                name: "data",
                persistentVolumeClaim: { claimName: names.dataPvc },
              },
              {
                name: "tsstate",
                persistentVolumeClaim: { claimName: names.statePvc },
              },
            ],
          },
        },
      },
    };
  }

  // ---- API helpers ----

  private corePath(kind: string, name: string): string {
    return `/api/v1/namespaces/${this.config.namespace}/${kind}/${name}`;
  }

  private appsPath(kind: string, name: string): string {
    return `/apis/apps/v1/namespaces/${this.config.namespace}/${kind}/${name}`;
  }

  private applyPvc(name: string, instance: string, size: string) {
    return this.apply(
      this.corePath("persistentvolumeclaims", name),
      this.pvcFor(name, instance, size),
    );
  }

  /** Server-side apply: create-or-adopt in one idempotent call. */
  private apply(
    path: string,
    manifest: unknown,
    opts: { redactBody?: boolean } = {},
  ): Promise<unknown> {
    return this.request(
      "PATCH",
      `${path}?fieldManager=p0rt1on&force=true`,
      manifest,
      { contentType: "application/apply-patch+yaml", ...opts },
    );
  }

  private async scale(instanceName: string, replicas: number): Promise<void> {
    await this.request(
      "PATCH",
      this.appsPath(
        "statefulsets",
        resourceNames(instanceName).statefulSet,
      ),
      { spec: { replicas } },
      { contentType: "application/merge-patch+json" },
    );
  }

  /** GET that maps 404 to null (absence is a normal state, not an error). */
  private async get(path: string): Promise<unknown | null> {
    try {
      return await this.request("GET", path);
    } catch (err) {
      if (err instanceof ServiceError && /\(404\)/.test(err.message)) {
        return null;
      }
      throw err;
    }
  }

  /** DELETE tolerating 404 (teardown idempotency house rule). */
  private async delete(path: string): Promise<void> {
    try {
      await this.request("DELETE", path);
    } catch (err) {
      if (err instanceof ServiceError && /\(404\)/.test(err.message)) return;
      throw err;
    }
  }

  /** `pods/{name}/log --tail 50` equivalent; "" on failure (best-effort). */
  private async logs(podName: string): Promise<string> {
    const res = await this.fetchFn(
      `${this.base}${this.corePath("pods", podName)}/log?tailLines=50`,
      { headers: { Authorization: `Bearer ${this.config.token}` } },
    );
    return res.ok ? (await res.text()).trim() : "";
  }

  /** Recursive bounded poll of pod readiness (mirrors the docker runtime). */
  private async pollHealth(name: string, attemptsLeft: number): Promise<void> {
    const health = await this.instanceHealth(name);
    if (health === "healthy") return;
    if (attemptsLeft <= 0) {
      throw new ServiceError(
        "INTERNAL_SERVER_ERROR",
        `instance ${name} did not become healthy (last status: ${health})`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 2000));
    return this.pollHealth(name, attemptsLeft - 1);
  }

  /**
   * Authenticated request; throws ServiceError on non-2xx. `redactBody`
   * requests never echo the request body or the API's response text into the
   * error (Secret payloads).
   */
  private async request(
    method: string,
    path: string,
    body?: unknown,
    opts: { contentType?: string; redactBody?: boolean } = {},
  ): Promise<unknown> {
    const res = await this.fetchFn(`${this.base}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.config.token}`,
        "Content-Type": opts.contentType ?? "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!res.ok) {
      const text = opts.redactBody
        ? "«response redacted: request carried secret material»"
        : await res.text().catch(() => "");
      throw new ServiceError(
        "INTERNAL_SERVER_ERROR",
        `k8s ${method} ${path} failed (${res.status}): ${text}`,
      );
    }
    if (res.status === 204) return undefined;
    return await res.json().catch(() => undefined);
  }
}

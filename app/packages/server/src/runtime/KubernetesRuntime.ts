import type {
  ContainerHandle,
  ContainerState,
  InstanceDiagnostics,
  InstanceHealth,
  InstanceRuntime,
  InstanceSpec,
  InstanceTailscaleOptions,
} from "./runtime.ts";
import { tailscaleEnv } from "./runtime.ts";
import { ServiceError } from "../lib/ServiceError.ts";
import type { RestClient } from "@cloudydeno/kubernetes-client";
import {
  KubeConfig as ClientKubeConfig,
  KubeConfigRestClient,
} from "@cloudydeno/kubernetes-client";
import { CoreV1Api } from "@cloudydeno/kubernetes-apis/core/v1";
import { AppsV1Api } from "@cloudydeno/kubernetes-apis/apps/v1";
import type { Pod } from "@cloudydeno/kubernetes-apis/core/v1";
import type { StatefulSet } from "@cloudydeno/kubernetes-apis/apps/v1";
import { toQuantity } from "@cloudydeno/kubernetes-apis/common.ts";

export interface KubeConfig {
  namespace: string;
  /** Per-friend quota is enforced at the MinIO bucket level, not by PVC size. */
  dataSize: string;
  stateSize: string;
  /** The StorageClass every portion's DATA PVC is provisioned from; tailscale
   * state stays off it and uses the cluster default class. */
  pantryStorageClass: string;
  /** Instance enrollment extras for the headscale test tier; when absent, SaaS
   * defaults apply. */
  tailscale?: InstanceTailscaleOptions;
  /** Per-portion container CPU/memory caps, as native k8s quantity values. */
  resources?: {
    cpuRequest?: string;
    cpuLimit?: string;
    memoryRequest?: string;
    memoryLimit?: string;
  };
}

export interface KubeConnection {
  /** Omit to auto-detect the in-cluster server. */
  apiBase?: string;
  /** The ServiceAccount bearer token; in-cluster this is the mounted token
   * file's contents. */
  token?: string;
  /** The cluster CA certificate, as PEM. */
  caCert?: string;
}

const LABEL_KEY = "app.kubernetes.io/managed-by";
const LABEL_VALUE = "p0rt1on";
const LABEL_SELECTOR = `${LABEL_KEY}=${LABEL_VALUE}`;
const FIELD_MANAGER = "p0rt1on";

/** Resource names derived from the instance name, which is already a DNS label. */
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

/** cloudydeno throws an Error carrying the HTTP status as `httpCode`. */
function httpCode(err: unknown): number | undefined {
  return (err as { httpCode?: number })?.httpCode;
}

export function buildRestClient(conn: KubeConnection): Promise<RestClient> {
  if (!conn.token && !conn.apiBase) return KubeConfigRestClient.forInCluster();
  const kc = new ClientKubeConfig({
    apiVersion: "v1",
    kind: "Config",
    "current-context": "p0rt1on",
    contexts: [{ name: "p0rt1on", context: { cluster: "c", user: "u" } }],
    clusters: [{
      name: "c",
      cluster: {
        server: conn.apiBase ?? "https://kubernetes.default.svc",
        ...(conn.caCert
          ? { "certificate-authority-data": btoa(conn.caCert) }
          : {}),
      },
    }],
    users: [{ name: "u", user: { token: conn.token } }],
  });
  return KubeConfigRestClient.forKubeConfigContext(kc.fetchContext());
}

export class KubernetesRuntime implements InstanceRuntime {
  private readonly core: ReturnType<CoreV1Api["namespace"]>;
  private readonly apps: ReturnType<AppsV1Api["namespace"]>;

  constructor(
    private readonly config: KubeConfig,
    private readonly client: RestClient,
  ) {
    this.core = new CoreV1Api(client).namespace(config.namespace);
    this.apps = new AppsV1Api(client).namespace(config.namespace);
  }

  async ensureInstance(spec: InstanceSpec): Promise<ContainerHandle> {
    const names = resourceNames(spec.name);
    const labels = this.labels(spec.name);
    // Server-side apply is create-or-adopt in one idempotent call. PVCs are
    // applied directly rather than via volumeClaimTemplates so teardown gates
    // their deletion explicitly.
    await this.applyPvc(
      names.dataPvc,
      labels,
      this.config.dataSize,
      this.config.pantryStorageClass,
    );
    await this.applyPvc(names.statePvc, labels, this.config.stateSize);
    // The Secret carries the root cred and enrollment key; a failed apply must
    // never echo it, so the error is mapped to a redacted one.
    await this.redacting(() =>
      this.core.patchSecret(names.secret, "apply-patch", {
        metadata: { name: names.secret, labels },
        stringData: {
          MINIO_ROOT_USER: spec.rootCred.accessKeyId,
          MINIO_ROOT_PASSWORD: spec.rootCred.secretKey,
          TAILSCALE_AUTHKEY: spec.tsAuthKey,
        },
      }, this.applyOpts)
    );
    await this.core.patchService(names.service, "apply-patch", {
      metadata: { name: names.service, labels },
      spec: {
        selector: { "p0rt1on/instance": spec.name },
        ports: [{ port: spec.minioPort, targetPort: spec.minioPort }],
      },
    }, this.applyOpts);
    await this.apps.patchStatefulSet(
      names.statefulSet,
      "apply-patch",
      this.statefulSetFor(spec, labels),
      this.applyOpts,
    );
    return { name: spec.name, id: names.statefulSet, state: "running" };
  }

  adminEndpoint(instanceName: string, minioPort: number): string {
    const svc = resourceNames(instanceName).service;
    return `http://${svc}.${this.config.namespace}.svc:${minioPort}`;
  }

  async waitUntilHealthy(instanceName: string): Promise<void> {
    await this.pollHealth(instanceName, 60);
  }

  async ensureRunning(instanceName: string): Promise<void> {
    const sts = await this.getOrNull(() =>
      this.apps.getStatefulSet(resourceNames(instanceName).statefulSet)
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
    const pod = await this.getOrNull(() =>
      this.core.getPod(resourceNames(instanceName).pod)
    );
    if (pod === null) return "unknown";
    return this.healthOf(pod);
  }

  async hasData(instanceName: string): Promise<boolean> {
    // The data PVC outlives the StatefulSet (retention Retain), so its presence
    // is what says "the data survives" after a pod/STS is gone.
    const pvc = await this.getOrNull(() =>
      this.core.getPersistentVolumeClaim(resourceNames(instanceName).dataPvc)
    );
    return pvc !== null;
  }

  async listInstances(): Promise<{ name: string; state: ContainerState }[]> {
    const list = await this.apps.getStatefulSetList({
      labelSelector: LABEL_SELECTOR,
    });
    return list.items
      .filter((i) => typeof i.metadata?.name === "string")
      .map((i) => ({
        name: i.metadata?.name as string,
        state: (i.spec?.replicas ?? 1) === 0 ? "stopped" : "running",
      }));
  }

  async stopInstance(instanceName: string): Promise<void> {
    // Scale to 0: a deleted pod would just be resurrected by the controller.
    // Data and Secret stay. "Already absent" is success.
    await this.scale(instanceName, 0).catch((err) => {
      if (httpCode(err) === 404) return;
      throw err;
    });
  }

  async removeInstance(
    instanceName: string,
    opts: { removeData: boolean },
  ): Promise<void> {
    const names = resourceNames(instanceName);
    await this.deleteTolerant(() =>
      this.apps.deleteStatefulSet(names.statefulSet)
    );
    await this.deleteTolerant(() => this.core.deleteService(names.service));
    await this.deleteTolerant(() => this.core.deleteSecret(names.secret));
    if (opts.removeData) {
      // With a reclaimPolicy Delete pantry class this reclaims the PV and the data;
      // a Retain class would orphan the PV for manual recovery instead.
      await this.deleteTolerant(() =>
        this.core.deletePersistentVolumeClaim(names.dataPvc)
      );
      await this.deleteTolerant(() =>
        this.core.deletePersistentVolumeClaim(names.statePvc)
      );
    }
  }

  async diagnoseInstance(instanceName: string): Promise<InstanceDiagnostics> {
    const names = resourceNames(instanceName);
    const pod = await this.getOrNull(() => this.core.getPod(names.pod));
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
    const container = pod.status?.containerStatuses?.[0];
    const waiting = container?.state?.waiting;
    const terminated = container?.state?.terminated;
    return {
      name: names.pod,
      state: pod.status?.phase === "Running" ? "running" : "stopped",
      health: this.healthOf(pod),
      healthReason: waiting?.reason ?? waiting?.message ?? null,
      exitCode: terminated?.exitCode ?? null,
      exitError: terminated?.message ?? null,
      recentLogs: await this.logs(names.pod),
    };
  }

  // ---- helpers ----

  private labels(instance: string) {
    return { [LABEL_KEY]: LABEL_VALUE, "p0rt1on/instance": instance };
  }

  private get applyOpts() {
    return { fieldManager: FIELD_MANAGER, force: true };
  }

  private healthOf(pod: Pod): InstanceHealth {
    const container = pod.status?.containerStatuses?.[0];
    if (container?.ready) return "healthy";
    const waiting = container?.state?.waiting?.reason ?? "";
    if (waiting === "CrashLoopBackOff" || container?.state?.terminated) {
      return "unhealthy";
    }
    return "starting";
  }

  private containerResources() {
    const r = this.config.resources;
    const requests = {
      ...(r?.cpuRequest ? { cpu: toQuantity(r.cpuRequest) } : {}),
      ...(r?.memoryRequest ? { memory: toQuantity(r.memoryRequest) } : {}),
    };
    const limits = {
      ...(r?.cpuLimit ? { cpu: toQuantity(r.cpuLimit) } : {}),
      ...(r?.memoryLimit ? { memory: toQuantity(r.memoryLimit) } : {}),
    };
    const out = {
      ...(Object.keys(requests).length ? { requests } : {}),
      ...(Object.keys(limits).length ? { limits } : {}),
    };
    return Object.keys(out).length ? out : undefined;
  }

  private applyPvc(
    name: string,
    labels: Record<string, string>,
    size: string,
    storageClass?: string,
  ): Promise<unknown> {
    return this.core.patchPersistentVolumeClaim(name, "apply-patch", {
      metadata: { name, labels },
      spec: {
        accessModes: ["ReadWriteOnce"],
        resources: { requests: { storage: toQuantity(size) } },
        // Left unset, the PVC gets the cluster default class.
        ...(storageClass ? { storageClassName: storageClass } : {}),
      },
    }, this.applyOpts);
  }

  private statefulSetFor(
    spec: InstanceSpec,
    labels: Record<string, string>,
  ): StatefulSet {
    const names = resourceNames(spec.name);
    return {
      metadata: { name: names.statefulSet, labels },
      spec: {
        replicas: 1,
        serviceName: names.service,
        // Deleting the StatefulSet must NOT delete a friend's data — only offboard
        // deletes PVCs. Set explicitly so a default flip can never drop backups.
        persistentVolumeClaimRetentionPolicy: {
          whenScaled: "Retain",
          whenDeleted: "Retain",
        },
        selector: { matchLabels: { "p0rt1on/instance": spec.name } },
        template: {
          metadata: { labels },
          spec: {
            // Instance pods never talk to the k8s API — a compromised
            // (friend-facing) pod must find no API credential inside.
            automountServiceAccountToken: false,
            // The full PSA `restricted` set: the namespace enforces it, and
            // omitting any field gets the pod rejected. The image defaults to
            // root, hence the explicit uid; fsGroup makes the PVCs writable.
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
              resources: this.containerResources(),
              envFrom: [{ secretRef: { name: names.secret } }],
              env: [
                // Userspace tailscaled needs zero capabilities and no
                // /dev/net/tun, letting the namespace enforce PSA `restricted`.
                { name: "TS_USERSPACE", value: "true" },
                { name: "TAILSCALE_HOSTNAME", value: spec.name },
                { name: "MINIO_PORT", value: String(spec.minioPort) },
                ...Object.entries(tailscaleEnv(this.config.tailscale))
                  .map(([name, value]) => ({ name, value })),
              ],
              ports: [{ containerPort: spec.minioPort }],
              // The same script as the docker HEALTHCHECK: tailscale up AND
              // MinIO live.
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

  private async scale(instanceName: string, replicas: number): Promise<void> {
    // json-patch the main resource rather than the `/scale` subresource, which
    // would need its own RBAC verb; a json-patch is typed as an array, so there
    // is no partial-spec issue.
    await this.apps.patchStatefulSet(
      resourceNames(instanceName).statefulSet,
      "json-patch",
      [{ op: "replace", path: "/spec/replicas", value: replicas }],
    );
  }

  /** Maps 404 to null — absence is a normal state. */
  private async getOrNull<T>(fn: () => Promise<T>): Promise<T | null> {
    try {
      return await fn();
    } catch (err) {
      if (httpCode(err) === 404) return null;
      throw err;
    }
  }

  /** Tolerates 404: teardown is idempotent, so already absent is success. */
  private async deleteTolerant(fn: () => Promise<unknown>): Promise<void> {
    try {
      await fn();
    } catch (err) {
      if (httpCode(err) === 404) return;
      throw err;
    }
  }

  /** Run a secret-carrying call; on failure re-throw WITHOUT the API's message
   * (which we don't control) so no secret material can leak into logs/errors. */
  private async redacting<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (err) {
      throw new ServiceError(
        "INTERNAL_SERVER_ERROR",
        `k8s secret operation failed (${
          httpCode(err) ?? "?"
        }): «response redacted: request carried secret material»`,
      );
    }
  }

  /** Returns "" on failure — logs are best-effort. */
  private async logs(podName: string): Promise<string> {
    try {
      const log = await this.core.getPodLog(podName, { tailLines: 50 });
      return log.trim();
    } catch {
      return "";
    }
  }

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
}

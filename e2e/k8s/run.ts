// A cluster this run creates is deleted on exit, unless K8S_E2E_KEEP=1; a
// pre-existing cluster belongs to the user and is left alone.
import $ from "@david/dax";
import { parseKeyOutput, requireBinaries } from "../driver.ts";
import { DEFAULT_HEADSCALE_URL, until } from "../helpers.ts";

const MODES = ["all", "build", "rbac-psa", "lifecycle", "clean"] as const;
const mode = Deno.args[0] ?? "all";
if (!(MODES as readonly string[]).includes(mode)) {
  console.error(`usage: deno task test:e2e:k8s [${MODES.join("|")}]`);
  Deno.exit(2);
}

Deno.chdir(new URL("../..", import.meta.url));
requireBinaries("docker", "k3d", "kubectl", "helm");

const CLUSTER = Deno.env.get("K8S_E2E_CLUSTER") ?? "p0rt1on-e2e";
const CTX = `k3d-${CLUSTER}`;
// Tags avoid :latest, since that would default imagePullPolicy to
// Always, and these images only ever exist locally.
const INSTANCE_IMAGE = "p0rt1on-instance:e2e";
const MANAGER_IMAGE = "p0rt1on-manager:e2e";
const CLIENT_IMAGE = "p0rt1on-backup-client:e2e";
const RUNNER_IMAGE = "p0rt1on-e2e-runner:e2e";
const HEADSCALE_URL = DEFAULT_HEADSCALE_URL;
const MANAGER_SECRET = "p0rt1on-manager-secrets";
const MANAGER_URL = "http://p0rt1on-manager-admin.p0rt1on.svc:8080";
const RUNNER = "p0rt1on-e2e-runner";

// Every kubectl call pins the k3d context, never the user's current
// context, since that could be a real cluster this driver must not touch.
const kc = (args: string[]) => $`kubectl --context ${CTX} ${args}`;
// Same discipline for helm: --kube-context pins it to the k3d cluster.
const helm = (args: string[]) => $`helm --kube-context ${CTX} ${args}`;

const headscale = (args: string[]) =>
  kc(["exec", "deploy/headscale", "-n", "p0rt1on", "--", "headscale", ...args]);

const state = { createdCluster: false, toreDown: false };

async function teardown(): Promise<void> {
  if (state.toreDown) return;
  state.toreDown = true;
  if (!state.createdCluster || Deno.env.get("K8S_E2E_KEEP") === "1") {
    return;
  }
  const del = await $`k3d cluster delete ${CLUSTER}`.noThrow().quiet();
  if (del.code !== 0) {
    console.error(
      `WARNING: failed to delete cluster ${CLUSTER}: ${del.stderr.trim()}`,
    );
  }
}

// Polls because there is no readiness probe; a finished rollout can still
// precede the CLI socket being ready.
async function ensureHeadscaleUser(): Promise<void> {
  const users = await until(
    "headscale CLI to answer",
    async () => {
      const list = await headscale(["users", "list", "--output", "json"])
        .noThrow().quiet();
      return list.code === 0 ? list.stdout : null;
    },
    30,
    2000,
  );
  if (users.includes('"p0rt1on"')) return;
  await headscale(["users", "create", "p0rt1on"]);
}

async function setup(): Promise<void> {
  const exists = await $`k3d cluster list ${CLUSTER}`.noThrow().quiet();
  if (exists.code !== 0) {
    // Never switches the user's current kubectl context on cluster
    // creation, though kc already pins --context on every call.
    await $`k3d cluster create ${CLUSTER} --wait --timeout 120s --kubeconfig-switch-context=false`;
    state.createdCluster = true;
  }
  await installPantryProvisioner();
  await kc(["apply", "-f", "deploy/k8s/p0rt1on.yaml"]);
  await kc(["apply", "-f", "e2e/k8s/manifests.yaml"]);
  // The manager runs only during the lifecycle suite; parked at 0 otherwise.
  await kc([
    "scale",
    "deployment",
    "p0rt1on-manager",
    "-n",
    "p0rt1on",
    "--replicas=0",
  ]);
}

// deploy/k8s/pantry.yaml is only the StorageClass; it depends on the
// OpenEBS localpv provisioner, which is helm-only (no upstream plain-YAML
// install). Every non-hostpath engine and the bundled Loki/Alloy stack are
// disabled: the chart's defaults otherwise stand up replicated storage plus
// a 3-replica MinIO-backed observability stack that can't schedule on a
// single-node k3d cluster. Flags match deploy/k8s/pantry.yaml's own header.
async function installPantryProvisioner(): Promise<void> {
  await $`helm repo add openebs https://openebs.github.io/openebs`.noThrow()
    .quiet();
  await helm([
    "upgrade",
    "--install",
    "openebs",
    "openebs/openebs",
    "-n",
    "openebs",
    "--create-namespace",
    "--set",
    "engines.local.lvm.enabled=false",
    "--set",
    "engines.local.zfs.enabled=false",
    "--set",
    "engines.replicated.mayastor.enabled=false",
    "--set",
    "loki.enabled=false",
    "--set",
    "alloy.enabled=false",
  ]);
  await kc(["apply", "-f", "deploy/k8s/pantry.yaml"]);
  // The first PVC races the provisioner and fails with ExternalProvisioning
  // if it isn't Ready yet — a sleep here would be a guess, this isn't.
  await kc([
    "rollout",
    "status",
    "deployment/openebs-localpv-provisioner",
    "-n",
    "openebs",
    "--timeout=120s",
  ]);
}

async function buildImages(): Promise<void> {
  await $`docker build -t ${INSTANCE_IMAGE} instance`;
  await $`docker build -t ${MANAGER_IMAGE} .`;
  await $`docker build -t ${CLIENT_IMAGE} backup-client`;
  await $`docker build -f e2e/Dockerfile -t ${RUNNER_IMAGE} .`;
  await $`k3d image import ${INSTANCE_IMAGE} ${MANAGER_IMAGE} ${CLIENT_IMAGE} ${RUNNER_IMAGE} -c ${CLUSTER}`;
}

async function rbacPsa(): Promise<void> {
  const server = await kc([
    "config",
    "view",
    "-o",
    `jsonpath={.clusters[?(@.name=='${CTX}')].cluster.server}`,
  ]).text();
  const caB64 = await kc([
    "config",
    "view",
    "--raw",
    "-o",
    `jsonpath={.clusters[?(@.name=='${CTX}')].cluster.certificate-authority-data}`,
  ]).text();
  const caFile = await Deno.makeTempFile({ prefix: "p0rt1on-e2e-ca-" });
  await Deno.writeFile(
    caFile,
    Uint8Array.from(atob(caB64), (c) => c.charCodeAt(0)),
  );
  try {
    const token = await kc([
      "create",
      "token",
      "p0rt1on-manager",
      "-n",
      "p0rt1on",
      "--duration=15m",
    ]).text();
    await $`deno test --allow-read --allow-env --allow-net --unstable-net e2e/k8s/rbac-psa.e2e.test.ts`
      .env({
        K8S_E2E_SERVER: server,
        K8S_E2E_TOKEN: token,
        K8S_E2E_CA: caFile,
      });
  } finally {
    await Deno.remove(caFile).catch(() => undefined);
  }
}

async function lifecycle(): Promise<void> {
  // Restarts headscale each run, because a stale node makes it rename the
  // new one on hostname collision, which breaks offboard's cleanup.
  await kc(["rollout", "restart", "deployment/headscale", "-n", "p0rt1on"]);
  await kc([
    "rollout",
    "status",
    "deployment/headscale",
    "-n",
    "p0rt1on",
    "--timeout=120s",
  ]);
  await ensureHeadscaleUser();
  await resetManagerState();
  await writeManagerSecret();
  await startManager();
  try {
    await runRunnerPod();
  } finally {
    await kc([
      "scale",
      "deployment",
      "p0rt1on-manager",
      "-n",
      "p0rt1on",
      "--replicas=0",
    ]).noThrow().quiet();
  }
}

// Wipes the manager's PVC before each run; a kept cluster would otherwise
// carry stale friend rows and fail addStart on the unique name.
async function resetManagerState(): Promise<void> {
  await kc([
    "delete",
    "pvc",
    "p0rt1on-manager-data",
    "-n",
    "p0rt1on",
    "--ignore-not-found",
  ]);
  await kc(["apply", "-f", "deploy/k8s/p0rt1on.yaml"]);
}

// Deletes the Secret before recreating it, so the shipped manifest's
// placeholder values can't survive a merge.
async function writeManagerSecret(): Promise<void> {
  const apiKey = parseKeyOutput(
    await headscale(["apikeys", "create", "--expiration", "1h"]).text(),
  );
  await kc([
    "delete",
    "secret",
    MANAGER_SECRET,
    "-n",
    "p0rt1on",
    "--ignore-not-found",
  ]);
  await kc(["apply", "-f", "-"]).stdinText(JSON.stringify({
    apiVersion: "v1",
    kind: "Secret",
    metadata: { name: MANAGER_SECRET, namespace: "p0rt1on" },
    stringData: {
      P0RT1ON_MASTER_KEY: "k8s-e2e-master-key",
      P0RT1ON_ADMIN_USERNAME: "e2e-admin",
      P0RT1ON_ADMIN_PASSWORD: crypto.randomUUID(),
      P0RT1ON_ADMIN_BIND_HOST: "0.0.0.0",
      P0RT1ON_TAILSCALE_BACKEND: "headscale",
      P0RT1ON_TAILSCALE_SERVE_MODE: "http",
      // headscale tags are owned by a user, never by another tag.
      P0RT1ON_TAILSCALE_TAG_OWNER: "p0rt1on@",
      P0RT1ON_HEADSCALE_URL: HEADSCALE_URL,
      P0RT1ON_HEADSCALE_API_KEY: apiKey,
      P0RT1ON_HEADSCALE_USER: "p0rt1on",
      P0RT1ON_HEADSCALE_BASE_DOMAIN: "hs.test",
      P0RT1ON_INSTANCE_IMAGE: INSTANCE_IMAGE,
    },
  }));
}

// imagePullPolicy must be IfNotPresent, since k3d-imported images can
// never be pulled from a registry.
async function startManager(): Promise<void> {
  await kc([
    "patch",
    "deployment",
    "p0rt1on-manager",
    "-n",
    "p0rt1on",
    "--type",
    "strategic",
    "-p",
    JSON.stringify({
      spec: {
        template: {
          spec: {
            containers: [{
              name: "manager",
              image: MANAGER_IMAGE,
              imagePullPolicy: "IfNotPresent",
            }],
          },
        },
      },
    }),
  ]);
  await kc([
    "scale",
    "deployment",
    "p0rt1on-manager",
    "-n",
    "p0rt1on",
    "--replicas=1",
  ]);
  const roll = await kc([
    "rollout",
    "status",
    "deployment/p0rt1on-manager",
    "-n",
    "p0rt1on",
    "--timeout=120s",
  ]).noThrow();
  if (roll.code !== 0) {
    // Failure artifact BEFORE teardown deletes the evidence.
    await kc([
      "describe",
      "pods",
      "-n",
      "p0rt1on",
      "-l",
      "app=p0rt1on-manager",
    ]).noThrow();
    await kc(["logs", "-n", "p0rt1on", "deploy/p0rt1on-manager", "--tail=50"])
      .noThrow();
    throw new Error("manager deployment failed to roll out");
  }
}

// The pod manifest holds no secrets inline; admin creds and the headscale
// key come from the Secret by reference.
function runnerPodManifest(): unknown {
  const secretEnv = (name: string, key = name) => ({
    name,
    valueFrom: { secretKeyRef: { name: MANAGER_SECRET, key } },
  });

  return {
    apiVersion: "v1",
    kind: "Pod",
    metadata: { name: RUNNER, namespace: "p0rt1on" },
    spec: {
      restartPolicy: "Never",
      serviceAccountName: "p0rt1on-manager",
      securityContext: {
        runAsNonRoot: true,
        // The image's `deno` user, which owns the cached deps.
        runAsUser: 1993,
        runAsGroup: 1993,
        seccompProfile: { type: "RuntimeDefault" },
      },
      containers: [{
        name: RUNNER,
        image: RUNNER_IMAGE,
        command: [
          "deno",
          "test",
          "--allow-read",
          "--allow-write",
          "--allow-env",
          "--allow-net",
          "--allow-run",
          "e2e/k8s/lifecycle.e2e.test.ts",
        ],
        env: [
          { name: "K8S_NAMESPACE", value: "p0rt1on" },
          { name: "CLIENT_IMAGE", value: CLIENT_IMAGE },
          { name: "HEADSCALE_URL", value: HEADSCALE_URL },
          { name: "MANAGER_URL", value: MANAGER_URL },
          secretEnv("P0RT1ON_ADMIN_USERNAME"),
          secretEnv("P0RT1ON_ADMIN_PASSWORD"),
          secretEnv("HEADSCALE_API_KEY", "P0RT1ON_HEADSCALE_API_KEY"),
          {
            name: "DENO_CERT",
            value: "/var/run/secrets/kubernetes.io/serviceaccount/ca.crt",
          },
          { name: "HOME", value: "/tmp" },
        ],
        securityContext: {
          allowPrivilegeEscalation: false,
          capabilities: { drop: ["ALL"] },
        },
      }],
    },
  };
}

async function podPhase(): Promise<string> {
  return await kc([
    "get",
    "pod",
    RUNNER,
    "-n",
    "p0rt1on",
    "-o",
    "jsonpath={.status.phase}",
  ]).text();
}

// The pod's terminal phase is the verdict, not the log stream, since a
// dropped stream re-attaches with --tail=0 instead of failing the run.
async function runRunnerPod(): Promise<void> {
  await kc(["delete", "pod", RUNNER, "-n", "p0rt1on", "--ignore-not-found"]);
  try {
    await kc(["apply", "-f", "-"]).stdinText(
      JSON.stringify(runnerPodManifest()),
    );
    await until(
      "runner pod to start",
      async () => {
        const p = await podPhase();
        return p && p !== "Pending" ? p : null;
      },
      60,
      2000,
    );
    const stream = { first: true };
    const phase = await until(
      "runner pod to finish",
      async () => {
        await kc([
          "logs",
          "-f",
          ...(stream.first ? [] : ["--tail=0"]),
          RUNNER,
          "-n",
          "p0rt1on",
        ]).noThrow();
        stream.first = false;
        const p = await podPhase();
        return p === "Succeeded" || p === "Failed" ? p : null;
      },
      30,
      2000,
    );
    if (phase !== "Succeeded") {
      // The manager's log usually names the step that broke.
      await kc([
        "logs",
        "-n",
        "p0rt1on",
        "deploy/p0rt1on-manager",
        "--tail=200",
      ])
        .noThrow();
      throw new Error(`runner pod ${phase}`);
    }
  } finally {
    await kc(["delete", "pod", RUNNER, "-n", "p0rt1on", "--ignore-not-found"])
      .noThrow().quiet();
  }
}

// `clean` skips setup, since running it would create a cluster only to
// immediately delete it.
if (mode === "clean") {
  const del = await $`k3d cluster delete ${CLUSTER}`.noThrow().quiet();
  if (del.code === 0) {
    console.log(`deleted cluster ${CLUSTER}`);
  } else {
    const still = await $`k3d cluster list ${CLUSTER}`.noThrow().quiet();
    if (still.code === 0) {
      console.error(`failed to delete ${CLUSTER}: ${del.stderr.trim()}`);
      Deno.exit(1);
    }
    console.log(`cluster ${CLUSTER} already absent`);
  }
  Deno.exit(0);
}

// Ctrl+C / SIGTERM still tears down a cluster this run created.
const onSignal = () => {
  teardown().finally(() => Deno.exit(130));
};

Deno.addSignalListener("SIGINT", onSignal);
Deno.addSignalListener("SIGTERM", onSignal);

const exitCode = await (async () => {
  try {
    await setup();
    if (mode === "build") {
      await buildImages();
    } else if (mode === "rbac-psa") {
      await rbacPsa();
    } else if (mode === "lifecycle") {
      await lifecycle();
    } else {
      await buildImages();
      await rbacPsa();
      await lifecycle();
    }
    return 0;
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    return 1;
  } finally {
    await teardown();
  }
})();
Deno.exit(exitCode);

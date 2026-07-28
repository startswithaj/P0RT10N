#!/usr/bin/env -S deno run --allow-run --allow-read --allow-write --allow-env
// k8s integration driver — REAL images, in-cluster headscale (no secrets).
//
//   ./integration-tests/k8s/run.ts          # build images + both tiers
//   ./integration-tests/k8s/run.ts build    # (re)build + import images only
//   ./integration-tests/k8s/run.ts tier1    # runtime tier (images built)
//   ./integration-tests/k8s/run.ts tier2    # portion tier (images built)
//   ./integration-tests/k8s/run.ts clean    # delete the k3d cluster
//
// A cluster this run CREATED is deleted on exit (K8S_INTEGRATIONTEST_KEEP=1
// keeps it); a pre-existing cluster is the user's and is left alone.
import { capture, parseKeyOutput, requireBinaries, run } from "../driver.ts";
import { DEFAULT_HEADSCALE_URL, until } from "../helpers.ts";

const MODES = ["all", "build", "tier1", "tier2", "clean"] as const;
const mode = Deno.args[0] ?? "all";
if (!(MODES as readonly string[]).includes(mode)) {
  console.error(`usage: run.ts [${MODES.join("|")}]`);
  Deno.exit(2);
}

// All paths below are repo-root relative.
Deno.chdir(new URL("../..", import.meta.url));
requireBinaries("docker", "k3d", {
  bin: "kubectl",
  probeArgs: ["version", "--client"],
});

const CLUSTER = Deno.env.get("K8S_INTEGRATIONTEST_CLUSTER") ??
  "p0rt1on-integrationtest";
const CTX = `k3d-${CLUSTER}`;
// NOT :latest — that defaults imagePullPolicy to Always and kubelet would try
// Docker Hub instead of the imported images.
const INSTANCE_IMAGE = "p0rt1on-instance:integrationtest";
const MANAGER_IMAGE = "p0rt1on-manager:integrationtest";
const CLIENT_IMAGE = "p0rt1on-backup-client:integrationtest";
const HEADSCALE_URL = DEFAULT_HEADSCALE_URL;
const API_KEY_SECRET = "p0rt1on-integrationtest-headscale";

// Every kubectl call is PINNED to the k3d context — never the user's current
// context (which may be a real cluster this driver must not touch).
const kc = (args: string[], opts = {}) =>
  run("kubectl", ["--context", CTX, ...args], opts);

const kcCapture = (args: string[], opts = {}) =>
  capture("kubectl", ["--context", CTX, ...args], opts);

const headscale = (args: string[], opts = {}) =>
  kcCapture(
    ["exec", "deploy/headscale", "-n", "p0rt1on", "--", "headscale", ...args],
    opts,
  );

const state = { createdCluster: false, toreDown: false };

async function teardown(): Promise<void> {
  if (state.toreDown) return;
  state.toreDown = true;
  if (
    !state.createdCluster || Deno.env.get("K8S_INTEGRATIONTEST_KEEP") === "1"
  ) {
    return;
  }
  const del = await capture("k3d", ["cluster", "delete", CLUSTER], {
    check: false,
  });
  if (del.code !== 0) {
    console.error(
      `WARNING: failed to delete cluster ${CLUSTER}: ${del.stderr.trim()}`,
    );
  }
}

// Idempotent across reruns (headscale state is an emptyDir, the pod persists).
async function ensureHeadscaleUser(): Promise<void> {
  const list = await headscale(["users", "list", "--output", "json"], {
    check: false,
  });
  if (list.code === 0 && list.stdout.includes('"p0rt1on"')) return;
  await headscale(["users", "create", "p0rt1on"]);
}

async function setup(): Promise<void> {
  const exists = await capture("k3d", ["cluster", "list", CLUSTER], {
    check: false,
  });
  if (exists.code !== 0) {
    // --kubeconfig-switch-context=false: never clobber the user's current
    // kubectl context (kc pins --context anyway).
    await run("k3d", [
      "cluster",
      "create",
      CLUSTER,
      "--wait",
      "--timeout",
      "120s",
      "--kubeconfig-switch-context=false",
    ]);
    state.createdCluster = true;
  }
  await kc(["apply", "-f", "deploy/k8s/p0rt1on.yaml"]);
  await kc(["apply", "-f", "integration-tests/k8s/manifests.yaml"]);
  // The manager Deployment isn't exercised (the runner pod plays the
  // manager); its unimported :latest image would just crash-loop.
  await kc([
    "scale",
    "deployment",
    "p0rt1on-manager",
    "-n",
    "p0rt1on",
    "--replicas=0",
  ]);
  await kc([
    "rollout",
    "status",
    "deployment/headscale",
    "-n",
    "p0rt1on",
    "--timeout=120s",
  ]);
  await ensureHeadscaleUser();
}

async function buildImages(): Promise<void> {
  await run("docker", ["build", "-t", INSTANCE_IMAGE, "instance"]);
  // --target integration: the suites live only in that stage, not in the
  // published manager image.
  await run("docker", [
    "build",
    "--target",
    "integration",
    "-t",
    MANAGER_IMAGE,
    ".",
  ]);
  await run("docker", ["build", "-t", CLIENT_IMAGE, "backup-client"]);
  await run("k3d", [
    "image",
    "import",
    INSTANCE_IMAGE,
    MANAGER_IMAGE,
    CLIENT_IMAGE,
    "-c",
    CLUSTER,
  ]);
}

// Mint a preauth key for a tag (user id 1 = the single user setup creates).
async function mintKey(tag: string): Promise<string> {
  const res = await headscale([
    "preauthkeys",
    "create",
    "--user",
    "1",
    "--tags",
    tag,
    "--expiration",
    "30m",
  ]);
  return parseKeyOutput(res.stdout);
}

// ---- tier 1: runtime mechanics, from the host as the manager SA ------------
async function tier1(): Promise<void> {
  const server = (await kcCapture([
    "config",
    "view",
    "-o",
    `jsonpath={.clusters[?(@.name=='${CTX}')].cluster.server}`,
  ])).stdout.trim();
  const caB64 = (await kcCapture([
    "config",
    "view",
    "--raw",
    "-o",
    `jsonpath={.clusters[?(@.name=='${CTX}')].cluster.certificate-authority-data}`,
  ])).stdout.trim();
  const caFile = await Deno.makeTempFile({
    prefix: "p0rt1on-integrationtest-ca-",
  });
  await Deno.writeFile(
    caFile,
    Uint8Array.from(atob(caB64), (c) => c.charCodeAt(0)),
  );
  try {
    const token = (await kcCapture([
      "create",
      "token",
      "p0rt1on-manager",
      "-n",
      "p0rt1on",
      "--duration=15m",
    ])).stdout.trim();
    // A tier-1-only tag: its node must never satisfy tier 2's
    // tag:p0rt1on-serve assertions.
    const authKey = await mintKey("tag:p0rt1on-integrationtest-tier1");
    await run("deno", [
      "test",
      "--allow-read",
      "--allow-write",
      "--allow-env",
      "--allow-net",
      "--unstable-net",
      "integration-tests/k8s/runtime.integration.test.ts",
    ], {
      env: {
        K8S_INTEGRATIONTEST_SERVER: server,
        K8S_INTEGRATIONTEST_TOKEN: token,
        K8S_INTEGRATIONTEST_CA: caFile,
        K8S_INTEGRATIONTEST_IMAGE: INSTANCE_IMAGE,
        K8S_INTEGRATIONTEST_AUTHKEY: authKey,
        K8S_INTEGRATIONTEST_LOGIN_SERVER: HEADSCALE_URL,
      },
    });
  } finally {
    await Deno.remove(caFile).catch(() => undefined);
  }
}

// ---- tier 2: portion-level, in-cluster (real headscale tailnet) ------------
async function tier2(): Promise<void> {
  // Clean control plane per run (state is an emptyDir, a restart wipes it):
  // stale nodes make headscale rename new ones (hostname collision), which
  // breaks offboard's hostname-matched cleanup.
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
  const apiKey = parseKeyOutput(
    (await headscale(["apikeys", "create", "--expiration", "1h"])).stdout,
  );

  // The API key reaches the pod via a Secret applied over STDIN — never argv
  // (kubectl's argv is world-readable in `ps` for the pod's lifetime).
  await kc(["apply", "-f", "-"], {
    stdin: JSON.stringify({
      apiVersion: "v1",
      kind: "Secret",
      metadata: { name: API_KEY_SECRET, namespace: "p0rt1on" },
      stringData: { apiKey },
    }),
  });

  await runRunnerPod();
}

const RUNNER = "p0rt1on-integrationtest-runner";

// The runner pod, built as a typed object (no JSON heredoc to misquote).
function runnerPodManifest(): unknown {
  return {
    apiVersion: "v1",
    kind: "Pod",
    metadata: { name: RUNNER, namespace: "p0rt1on" },
    spec: {
      restartPolicy: "Never",
      serviceAccountName: "p0rt1on-manager",
      securityContext: {
        runAsNonRoot: true,
        // The image's `deno` user — matches the chown baked into the
        // integration stage.
        runAsUser: 1993,
        runAsGroup: 1993,
        seccompProfile: { type: "RuntimeDefault" },
      },
      containers: [{
        name: RUNNER,
        image: MANAGER_IMAGE,
        command: [
          "deno",
          "test",
          "--allow-read",
          "--allow-write",
          "--allow-env",
          "--allow-ffi",
          "--allow-net",
          "--allow-run",
          "--unstable-ffi",
          "integration-tests/k8s/lifecycle.integration.test.ts",
        ],
        env: [
          { name: "K8S_NAMESPACE", value: "p0rt1on" },
          { name: "INSTANCE_IMAGE", value: INSTANCE_IMAGE },
          { name: "CLIENT_IMAGE", value: CLIENT_IMAGE },
          { name: "HEADSCALE_URL", value: HEADSCALE_URL },
          {
            name: "HEADSCALE_API_KEY",
            valueFrom: {
              secretKeyRef: { name: API_KEY_SECRET, key: "apiKey" },
            },
          },
          { name: "TAILSCALE_LOGIN_SERVER", value: HEADSCALE_URL },
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
  return (await kcCapture([
    "get",
    "pod",
    RUNNER,
    "-n",
    "p0rt1on",
    "-o",
    "jsonpath={.status.phase}",
  ])).stdout.trim();
}

// Create → stream logs → read the pod's terminal phase. NOT `kubectl run
// --attach --rm`: a dropped attach kills a passing run, and --rm deletes the
// evidence. A dropped log stream just re-attaches (--tail=0 after the first).
async function runRunnerPod(): Promise<void> {
  await kc(["delete", "pod", RUNNER, "-n", "p0rt1on", "--ignore-not-found"]);
  try {
    await kc(["apply", "-f", "-"], {
      stdin: JSON.stringify(runnerPodManifest()),
    });
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
        await run("kubectl", [
          "--context",
          CTX,
          "logs",
          "-f",
          ...(stream.first ? [] : ["--tail=0"]),
          RUNNER,
          "-n",
          "p0rt1on",
        ], { check: false });
        stream.first = false;
        const p = await podPhase();
        return p === "Succeeded" || p === "Failed" ? p : null;
      },
      30,
      2000,
    );
    if (phase !== "Succeeded") throw new Error(`runner pod ${phase}`);
  } finally {
    await kcCapture(
      ["delete", "pod", RUNNER, "-n", "p0rt1on", "--ignore-not-found"],
      { check: false },
    );
    await kcCapture([
      "delete",
      "secret",
      API_KEY_SECRET,
      "-n",
      "p0rt1on",
      "--ignore-not-found",
    ], { check: false });
  }
}

// `clean` must not run setup — that would create a cluster just to delete it.
if (mode === "clean") {
  const del = await capture("k3d", ["cluster", "delete", CLUSTER], {
    check: false,
  });
  if (del.code === 0) {
    console.log(`deleted cluster ${CLUSTER}`);
  } else {
    const still = await capture("k3d", ["cluster", "list", CLUSTER], {
      check: false,
    });
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
    } else if (mode === "tier1") {
      await tier1();
    } else if (mode === "tier2") {
      await tier2();
    } else {
      await buildImages();
      await tier1();
      await tier2();
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

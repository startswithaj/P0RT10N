#!/usr/bin/env bash
# k8s integration driver — REAL images only (manager, instance, backup-client);
# a local in-cluster headscale is the control plane, so no Tailscale account
# or secrets are needed.
#
#   1. RUNTIME tier: KubernetesRuntime.integration.test.ts as the
#      p0rt1on-manager SA — API mechanics, RBAC containment, PSA rejection —
#      with the real instance image enrolling against headscale.
#   2. PORTION tier (in-cluster pod): Provisioning.k8s.integration.test.ts —
#      a REAL add → rotate → offboard through the tRPC API with real `mc`,
#      the real instance image and the real HeadscaleHttpApi. Zero mocks.
#
# Usage:
#   ./integration-tests/run-integration.sh          # build images + both tiers
#   ./integration-tests/run-integration.sh build    # (re)build + import images only
#   ./integration-tests/run-integration.sh tier1    # runtime tier (images built)
#   ./integration-tests/run-integration.sh tier2    # portion tier (images built)
#
# Rebuild rule: app/ changed → build (manager image); instance/ changed →
# build; backup-client/ changed → build. Test-file-only edits: rerun a tier.
set -euo pipefail
cd "$(dirname "$0")/.."

MODE="${1:-all}"
CLUSTER="${K8S_INTEGRATIONTEST_CLUSTER:-p0rt1on-integrationtest}"
CTX="k3d-$CLUSTER"
# Every kubectl call is PINNED to the k3d context — never the user's current
# context (which may be a real cluster this script must not touch).
kc() { kubectl --context "$CTX" "$@"; }
# NOT :latest — that would default imagePullPolicy to Always and kubelet
# would try Docker Hub instead of the imported images.
INSTANCE_IMAGE="p0rt1on-instance:integrationtest"
MANAGER_IMAGE="p0rt1on-manager:integrationtest"
CLIENT_IMAGE="p0rt1on-backup-client:integrationtest"
HEADSCALE_URL="http://headscale.p0rt1on.svc:8080"

build_images() {
  docker build -t "$INSTANCE_IMAGE" instance
  # --target integration: the suites live only in that stage, not in the
  # published manager image.
  docker build --target integration -t "$MANAGER_IMAGE" .
  docker build -t "$CLIENT_IMAGE" backup-client
  k3d image import "$INSTANCE_IMAGE" "$MANAGER_IMAGE" "$CLIENT_IMAGE" \
    -c "$CLUSTER"
}

# Cluster + manifests + a ready headscale — idempotent, runs in every mode.
setup() {
  # k3d switches the default context on create; kc pins --context, so the
  # switch would only clobber the user's current-context for no gain.
  k3d cluster list "$CLUSTER" >/dev/null 2>&1 ||
    k3d cluster create "$CLUSTER" --wait --timeout 120s \
      --kubeconfig-switch-context=false
  kc apply -f deploy/k8s/p0rt1on.yaml
  kc apply -f integration-tests/headscale-integrationtest.yaml
  # The manager Deployment isn't exercised by these tiers (the runner pod
  # plays the manager) and its unimported :latest image would just
  # crash-loop and waste node disk — keep it at 0 during tests.
  kc scale deployment p0rt1on-manager -n p0rt1on --replicas=0
  kc rollout status deployment/headscale -n p0rt1on --timeout=120s
  # Idempotent across re-runs (state is an emptyDir, but the pod persists).
  kc exec deploy/headscale -n p0rt1on -- \
    headscale users create p0rt1on 2>/dev/null || true
}

# Mint a preauth key for a tag via the headscale CLI (user id 1 = the single
# user setup() creates). Last output line is the bare key.
mint_key() {
  kc exec deploy/headscale -n p0rt1on -- \
    headscale preauthkeys create --user 1 --tags "$1" --expiration 30m \
    2>/dev/null | tail -1
}

# ---- tier 1: runtime mechanics, from the host as the manager SA -------------
tier1() {
  SERVER="$(kc config view -o \
    jsonpath="{.clusters[?(@.name=='$CTX')].cluster.server}")"
  CA_FILE="$(mktemp)"
  trap 'rm -f "$CA_FILE"' EXIT
  kc config view --raw -o \
    jsonpath="{.clusters[?(@.name=='$CTX')].cluster.certificate-authority-data}" |
    base64 -d > "$CA_FILE"
  TOKEN="$(kc create token p0rt1on-manager -n p0rt1on --duration=15m)"

  # A tier-1-only tag: its node must never satisfy tier 2's
  # tag:p0rt1on-serve assertions.
  K8S_INTEGRATIONTEST_SERVER="$SERVER" \
    K8S_INTEGRATIONTEST_TOKEN="$TOKEN" \
    K8S_INTEGRATIONTEST_CA="$CA_FILE" \
    K8S_INTEGRATIONTEST_IMAGE="$INSTANCE_IMAGE" \
    K8S_INTEGRATIONTEST_AUTHKEY="$(mint_key tag:p0rt1on-integrationtest-tier1)" \
    K8S_INTEGRATIONTEST_LOGIN_SERVER="$HEADSCALE_URL" \
    deno test --allow-read --allow-write --allow-env --allow-net \
    --unstable-net \
    integration-tests/KubernetesRuntime.integration.test.ts
}

# ---- tier 2: portion-level, in-cluster (real headscale tailnet) -------------
tier2() {
  # Clean control plane per run (state is an emptyDir, a restart wipes it):
  # stale nodes from earlier runs make headscale rename new nodes
  # (hostname collision), which breaks offboard's hostname-matched cleanup.
  kc rollout restart deployment/headscale -n p0rt1on
  kc rollout status deployment/headscale -n p0rt1on --timeout=120s
  kc exec deploy/headscale -n p0rt1on -- \
    headscale users create p0rt1on 2>/dev/null || true
  HEADSCALE_API_KEY="$(kc exec deploy/headscale -n p0rt1on -- \
    headscale apikeys create --expiration 1h 2>/dev/null | tail -1)"

  kc delete pod p0rt1on-integrationtest-runner -n p0rt1on --ignore-not-found >/dev/null
  kc run p0rt1on-integrationtest-runner -n p0rt1on \
    --image="$MANAGER_IMAGE" --restart=Never --attach --rm \
    --overrides="$(cat <<JSON
{
  "spec": {
    "serviceAccountName": "p0rt1on-manager",
    "securityContext": {
      "runAsNonRoot": true, "runAsUser": 1000, "runAsGroup": 1000,
      "seccompProfile": {"type": "RuntimeDefault"}
    },
    "containers": [{
      "name": "p0rt1on-integrationtest-runner",
      "image": "$MANAGER_IMAGE",
      "command": ["deno", "test",
        "--allow-read", "--allow-write", "--allow-env", "--allow-ffi",
        "--allow-net", "--allow-run", "--unstable-ffi",
        "integration-tests/Provisioning.k8s.integration.test.ts"],
      "env": [
        {"name": "K8S_NAMESPACE", "value": "p0rt1on"},
        {"name": "INSTANCE_IMAGE", "value": "$INSTANCE_IMAGE"},
        {"name": "CLIENT_IMAGE", "value": "$CLIENT_IMAGE"},
        {"name": "HEADSCALE_URL", "value": "$HEADSCALE_URL"},
        {"name": "HEADSCALE_API_KEY", "value": "$HEADSCALE_API_KEY"},
        {"name": "TAILSCALE_LOGIN_SERVER", "value": "$HEADSCALE_URL"},
        {"name": "DENO_CERT",
         "value": "/var/run/secrets/kubernetes.io/serviceaccount/ca.crt"},
        {"name": "DENO_DIR", "value": "/tmp/deno"},
        {"name": "HOME", "value": "/tmp"}
      ],
      "securityContext": {
        "allowPrivilegeEscalation": false,
        "capabilities": {"drop": ["ALL"]}
      }
    }]
  }
}
JSON
)"
}

setup
case "$MODE" in
  build) build_images ;;
  tier1) tier1 ;;
  tier2) tier2 ;;
  all)
    build_images
    tier1
    tier2
    ;;
  *) echo "usage: $0 [build|tier1|tier2]" >&2 && exit 2 ;;
esac

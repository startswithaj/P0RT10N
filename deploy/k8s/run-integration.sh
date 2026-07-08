#!/usr/bin/env bash
# k8s integration driver — two tiers, no tailnet/secrets needed:
#
#   1. RUNTIME tier (host): KubernetesRuntime.integration.test.ts as the
#      p0rt1on-manager SA — API mechanics, RBAC containment, PSA rejection.
#      Stub image (busybox) — no MinIO.
#   2. PORTION tier (in-cluster pod): Provisioning.k8s.integration.test.ts —
#      a REAL add → rotate → offboard through ProvisioningService with real
#      `mc` + the real instance image (MinIO-only via TAILSCALE_DISABLED=1;
#      TailscaleApi mocked). Runs inside the cluster because it needs `mc`
#      (bundled in the manager image) + cluster DNS + the mounted SA.
#
#   ./deploy/k8s/run-integration.sh          # uses/creates cluster p0rt1on-it
set -euo pipefail
cd "$(dirname "$0")/../.."

CLUSTER="${K8S_IT_CLUSTER:-p0rt1on-it}"
# NOT :latest — that would default imagePullPolicy to Always and kubelet
# would try Docker Hub instead of the imported images.
STUB_IMAGE="p0rt1on-it-stub:it"
INSTANCE_IMAGE="p0rt1on-instance:it-notail"
MANAGER_IMAGE="p0rt1on-manager:it"

k3d cluster list "$CLUSTER" >/dev/null 2>&1 ||
  k3d cluster create "$CLUSTER" --wait --timeout 120s

docker build -t "$STUB_IMAGE" deploy/k8s/it-stub
docker build -t "p0rt1on-instance:it-base" instance
# Derivative with tailscale disabled baked in (MinIO-only; see entrypoint.sh).
printf 'FROM p0rt1on-instance:it-base\nENV TAILSCALE_DISABLED=1\n' |
  docker build -t "$INSTANCE_IMAGE" -
docker build -t "$MANAGER_IMAGE" .
k3d image import "$STUB_IMAGE" "$INSTANCE_IMAGE" "$MANAGER_IMAGE" -c "$CLUSTER"

kubectl apply -f deploy/k8s/p0rt1on.yaml
# The manager Deployment isn't exercised by these tiers (the runner pod plays
# the manager) and its unimported :latest image would just crash-loop and
# waste node disk — keep it at 0 during tests.
kubectl scale deployment p0rt1on-manager -n p0rt1on --replicas=0

# ---- tier 1: runtime mechanics, from the host as the manager SA -------------
CTX="k3d-$CLUSTER"
SERVER="$(kubectl config view -o \
  jsonpath="{.clusters[?(@.name=='$CTX')].cluster.server}")"
CA_FILE="$(mktemp)"
trap 'rm -f "$CA_FILE"' EXIT
kubectl config view --raw -o \
  jsonpath="{.clusters[?(@.name=='$CTX')].cluster.certificate-authority-data}" |
  base64 -d > "$CA_FILE"
TOKEN="$(kubectl create token p0rt1on-manager -n p0rt1on --duration=15m)"

P0RT1ON_INTEGRATION=1 \
  K8S_IT_SERVER="$SERVER" \
  K8S_IT_TOKEN="$TOKEN" \
  K8S_IT_CA="$CA_FILE" \
  K8S_IT_IMAGE="$STUB_IMAGE" \
  deno test --allow-read --allow-write --allow-env --allow-net --unstable-net \
  app/packages/server/src/runtime/KubernetesRuntime.integration.test.ts

# ---- tier 2: portion-level, in-cluster --------------------------------------
kubectl delete pod p0rt1on-it-runner -n p0rt1on --ignore-not-found >/dev/null
kubectl run p0rt1on-it-runner -n p0rt1on \
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
      "name": "p0rt1on-it-runner",
      "image": "$MANAGER_IMAGE",
      "command": ["deno", "test",
        "--allow-read", "--allow-write", "--allow-env", "--allow-ffi",
        "--allow-net", "--allow-run", "--unstable-ffi",
        "app/packages/server/src/provisioning/Provisioning.k8s.integration.test.ts"],
      "env": [
        {"name": "P0RT1ON_K8S_PORTION_IT", "value": "1"},
        {"name": "K8S_NAMESPACE", "value": "p0rt1on"},
        {"name": "INSTANCE_IMAGE", "value": "$INSTANCE_IMAGE"},
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

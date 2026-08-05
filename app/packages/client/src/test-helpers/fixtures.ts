// Central client test fixtures, shared across component tests. Mocks and fixtures
// live in test-helpers, never inline per test.
import type {
  FriendBundle,
  FriendListItem,
  ServiceStatus,
  StatusView,
} from "@p0rt1on/shared/domain";

export function makeFriend(
  overrides: Partial<FriendListItem> = {},
): FriendListItem {
  return {
    id: 7,
    name: "alice",
    isolationMode: "dedicated",
    status: "active",
    lockMode: "GOVERNANCE",
    lockRetentionDays: 30,
    usage: {
      bytesUsed: 5_000_000_000,
      objectCount: 12,
      quotaBytes: 100_000_000_000,
      fraction: 0.05,
      checkedAt: null,
    },
    requests24h: 0,
    lastRequestAt: null,
    enrollmentMode: "authKey",
    inviteStatus: null,
    hostnameWarning: null,
    ...overrides,
  };
}

/**
 * This is the "shown once" credentials bundle as friends.add returns it. It defaults to a
 * Tailscale auth-key command for key enroll, so omit `tailscaleUpCommand` to test the invite path.
 */
export function makeBundle(
  overrides: Partial<FriendBundle> = {},
): FriendBundle {
  return {
    name: "alice",
    s3Endpoint: "https://alice.tail1a2b.ts.net",
    bucket: "alice-backups",
    s3AccessKeyId: "AKIAEXAMPLEACCESSKEY",
    s3SecretKey: "s3cr3t-shown-once-value",
    tailscaleUpCommand: "tailscale up --authkey tskey-auth-abc123",
    kopiaQuickstart: "kopia repository create s3 --bucket alice-backups",
    ...overrides,
  };
}

/**
 * A Status-page service row (a MinIO instance, node, or host daemon). `state` maps to
 * page health: up = healthy, provisioning = coming-up/unknown (warning), down = unhealthy.
 */
export function makeService(
  overrides: Partial<ServiceStatus> = {},
): ServiceStatus {
  return {
    name: "alice-minio",
    detail: "alice.tail1a2b.ts.net",
    state: "up",
    instance: "alice-minio",
    ...overrides,
  };
}

export function makeStatusView(
  overrides: Partial<StatusView> = {},
): StatusView {
  return {
    minio: [makeService()],
    tailscale: [makeService({ name: "alice-node", detail: "node online" })],
    host: [
      makeService({
        name: "manager",
        detail: "manager daemon",
        instance: undefined,
      }),
    ],
    ...overrides,
  };
}

// Central client test fixtures. Shared across component tests (per the repo's
// "mocks/fixtures live in test-helpers, never inline per test" rule) so future
// stories building on the friends list reuse one canonical row shape.
import type { FriendBundle, FriendListItem } from "@p0rt1on/shared/domain";

/** A dashboard friend row with sane defaults; override any field per test. */
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
    ...overrides,
  };
}

/**
 * A "shown once" credentials bundle as friends.add returns it; override any
 * field per test. Defaults include a Tailscale auth-key command (key enroll);
 * omit `tailscaleUpCommand` for the invite path.
 */
export function makeBundle(
  overrides: Partial<FriendBundle> = {},
): FriendBundle {
  return {
    name: "alice",
    s3Endpoint: "https://alice.tail1a2b.ts.net",
    region: "us-east-1",
    bucket: "alice-backups",
    s3AccessKeyId: "AKIAEXAMPLEACCESSKEY",
    s3SecretKey: "s3cr3t-shown-once-value",
    tailscaleUpCommand: "tailscale up --authkey tskey-auth-abc123",
    kopiaQuickstart: "kopia repository create s3 --bucket alice-backups",
    ...overrides,
  };
}

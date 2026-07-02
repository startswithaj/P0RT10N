// Central client test fixtures. Shared across component tests (per the repo's
// "mocks/fixtures live in test-helpers, never inline per test" rule) so future
// stories building on the friends list reuse one canonical row shape.
import type { FriendListItem } from "@p0rt1on/shared/domain";

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

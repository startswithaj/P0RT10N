import type { MinioEvent } from "./parseMinioEvent.ts";

// ============================================================================
// The ONE place bucket→friend resolution and the anti-self-trigger filter
// live. A stream stage piped after parseMinioEvents (parse → resolve): metrics
// consumers read FriendEvents; they never resolve buckets or re-check access
// keys themselves.
// ============================================================================

/** A parsed MinIO event resolved to the friend that owns its bucket. */
export interface FriendEvent {
  event: MinioEvent;
  friendId: number;
}

/** Resolve a bucket to its friend (id + the bucket-scoped key we filter on).
 * The key is nullable — a friend without one recorded yet matches nothing, so
 * its events are dropped until provisioning records the key. */
export type FriendLookup = (
  bucket: string,
) => { id: number; s3AccessKeyId: string | null } | undefined;

/**
 * Stream stage: typed events → FriendEvents. Drops events for unknown buckets
 * AND events whose access key isn't the friend's own bucket-scoped key — the
 * manager's root-key polling (mc du/admin), which MinIO audits back to us.
 * That filter is also what stops the usage sampler's own `mc du` from
 * re-triggering itself.
 */
export function resolveFriend(lookup: FriendLookup) {
  return async function* (
    src: AsyncIterable<MinioEvent>,
  ): AsyncIterable<FriendEvent> {
    // deno-lint-ignore custom-no-imperative-loops/no-imperative-loops
    for await (const event of src) {
      const friend = lookup(event.bucket);
      if (friend && event.accessKey === friend.s3AccessKeyId) {
        yield { event, friendId: friend.id };
      }
    }
  };
}

import type { MinioEvent } from "./parseMinioEvent.ts";

export interface FriendEvent {
  event: MinioEvent;
  friendId: number;
}

/** The key is nullable: a friend without one recorded yet matches no events,
 * so its events are dropped until provisioning records the key. */
export type FriendLookup = (
  bucket: string,
) => { id: number; s3AccessKeyId: string | null } | undefined;

/** Drops events whose access key isn't the friend's own scoped key, excluding
 * the manager's own root-key polling so the usage sampler's `mc du` never re-triggers itself. */
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

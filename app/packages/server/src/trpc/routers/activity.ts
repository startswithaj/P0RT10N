import type { ActivityView } from "@p0rt1on/shared/domain";
import { getFriendInput } from "@p0rt1on/shared/domain";
import { publicProcedure, router } from "../trpc.ts";

/** Per-friend activity: a one-shot read and a live SSE stream. */
export const activityRouter = router({
  /** Current aggregate (e.g. for first paint before the stream connects). */
  current: publicProcedure
    .input(getFriendInput)
    .query(({ ctx, input }) => ctx.activityService.current(input.friendId)),

  /**
   * Live activity over SSE. tRPC drives the subscription from this async
   * generator; `signal` aborts when the client disconnects so the service can
   * unsubscribe from the aggregator.
   */
  stream: publicProcedure
    .input(getFriendInput)
    .subscription(async function* ({ ctx, input, signal }): AsyncGenerator<
      ActivityView
    > {
      // tRPC always supplies `signal` for subscriptions; fall back to a fresh
      // one rather than asserting, so a missing signal can't crash the stream.
      const abort = signal ?? new AbortController().signal;
      // Delegate straight to the service's async iterable (no imperative loop).
      yield* ctx.activityService.stream(input.friendId, abort);
    }),
});

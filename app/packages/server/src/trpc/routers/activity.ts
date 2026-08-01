import type { ActivityView } from "@p0rt1on/shared/domain";
import { getFriendInput } from "@p0rt1on/shared/domain";
import { protectedProcedure, router } from "../trpc.ts";

export const activityRouter = router({
  current: protectedProcedure
    .input(getFriendInput)
    .query(({ ctx, input }) => ctx.activityService.current(input.friendId)),

  /** signal aborts when the client disconnects, so the service can unsubscribe from the aggregator. */
  stream: protectedProcedure
    .input(getFriendInput)
    .subscription(async function* ({ ctx, input, signal }): AsyncGenerator<
      ActivityView
    > {
      // tRPC always supplies signal for subscriptions; this falls back to a fresh one
      // instead of asserting, so a missing signal can't crash the stream.
      const abort = signal ?? new AbortController().signal;
      yield* ctx.activityService.stream(input.friendId, abort);
    }),
});

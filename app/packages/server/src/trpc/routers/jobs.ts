import { jobInput } from "@p0rt1on/shared/domain";
import { loggedStream, protectedProcedure, router } from "../trpc.ts";

/**
 * Job observation. Jobs are STARTED by mutations (friends.addStart /
 * offboardStart); `progress` only observes the in-memory job — replaying
 * recorded events, then following live ones — so SSE reconnects are always
 * safe: they re-attach, never re-run. Failures (including unknown ids) arrive
 * as `error` DATA events, never stream errors.
 */
export const jobsRouter = router({
  progress: protectedProcedure
    .input(jobInput)
    .subscription(async function* ({ ctx, input }) {
      // progress() never throws by design; loggedStream is a backstop so a
      // JobService bug can't fail invisibly like the old welded streams did.
      yield* loggedStream(
        ctx.jobService.progress(input.jobId),
        ctx.logger,
        "jobs.progress",
      );
    }),

  /** Single-claim handover of an add job's once-shown bundle; wiped on return. */
  claimBundle: protectedProcedure
    .input(jobInput)
    .mutation(({ ctx, input }) => ctx.jobService.claimBundle(input.jobId)),
});

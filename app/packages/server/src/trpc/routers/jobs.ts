import { jobInput } from "@p0rt1on/shared/domain";
import { loggedStream, protectedProcedure, router } from "../trpc.ts";

/**
 * Progress only observes the in-memory job, replaying recorded events then following live ones, so SSE reconnects always re-attach and never re-run it.
 * Failures, including unknown ids, arrive as error data events, never as stream errors.
 */
export const jobsRouter = router({
  progress: protectedProcedure
    .input(jobInput)
    .subscription(async function* ({ ctx, input }) {
      // progress() never throws by design; loggedStream is a backstop so a JobService bug can't fail invisibly.
      yield* loggedStream(
        ctx.jobService.progress(input.jobId),
        ctx.logger,
        "jobs.progress",
      );
    }),

  /** Single-claim handover of the bundle; it's wiped from memory once claimed. */
  claimBundle: protectedProcedure
    .input(jobInput)
    .mutation(({ ctx, input }) => ctx.jobService.claimBundle(input.jobId)),
});

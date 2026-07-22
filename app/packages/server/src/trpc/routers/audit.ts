import { auditListInput } from "@p0rt1on/shared/domain";
import { protectedProcedure, router } from "../trpc.ts";

/** The audit log — every lifecycle event, newest first; `before` pages older. */
export const auditRouter = router({
  list: protectedProcedure
    .input(auditListInput)
    .query(({ ctx, input }) =>
      ctx.auditService.list(input.limit, input.before)
    ),
});

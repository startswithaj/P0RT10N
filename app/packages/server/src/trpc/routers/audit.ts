import { auditListInput } from "@p0rt1on/shared/domain";
import { protectedProcedure, router } from "../trpc.ts";

export const auditRouter = router({
  list: protectedProcedure
    .input(auditListInput)
    .query(({ ctx, input }) =>
      ctx.auditService.list(input.limit, input.before)
    ),
});

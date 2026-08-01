import { usageHistoryInput } from "@p0rt1on/shared/domain";
import { protectedProcedure, router } from "../trpc.ts";

export const usageRouter = router({
  history: protectedProcedure
    .input(usageHistoryInput)
    .query(({ ctx, input }) =>
      ctx.usageService.history(input.friendId, input.limit)
    ),
});

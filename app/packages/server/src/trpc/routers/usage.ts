import { usageHistoryInput } from "@p0rt1on/shared/domain";
import { publicProcedure, router } from "../trpc.ts";

/** Point-in-time usage (`mc du`) history, newest first. */
export const usageRouter = router({
  history: publicProcedure
    .input(usageHistoryInput)
    .query(({ ctx, input }) =>
      ctx.usageService.history(input.friendId, input.limit)
    ),
});

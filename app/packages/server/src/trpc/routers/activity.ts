import { getFriendInput } from "@p0rt1on/shared/domain";
import { protectedProcedure, router } from "../trpc.ts";

export const activityRouter = router({
  current: protectedProcedure
    .input(getFriendInput)
    .query(({ ctx, input }) => ctx.activityService.current(input.friendId)),
});

import { router } from "./trpc.ts";
import { friendsRouter } from "./routers/friends.ts";
import { usageRouter } from "./routers/usage.ts";
import { activityRouter } from "./routers/activity.ts";
import { statusRouter } from "./routers/status.ts";

/** The composed API. The Solid client imports `AppRouter` for end-to-end types. */
export const appRouter = router({
  friends: friendsRouter,
  usage: usageRouter,
  activity: activityRouter,
  status: statusRouter,
});

export type AppRouter = typeof appRouter;

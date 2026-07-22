import { router } from "./trpc.ts";
import { authRouter } from "./routers/auth.ts";
import { friendsRouter } from "./routers/friends.ts";
import { jobsRouter } from "./routers/jobs.ts";
import { usageRouter } from "./routers/usage.ts";
import { activityRouter } from "./routers/activity.ts";
import { auditRouter } from "./routers/audit.ts";
import { statusRouter } from "./routers/status.ts";

/** The composed API. The Solid client imports `AppRouter` for end-to-end types. */
export const appRouter = router({
  auth: authRouter,
  friends: friendsRouter,
  jobs: jobsRouter,
  usage: usageRouter,
  activity: activityRouter,
  audit: auditRouter,
  status: statusRouter,
});

export type AppRouter = typeof appRouter;

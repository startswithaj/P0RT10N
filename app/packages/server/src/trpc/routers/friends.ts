import {
  addFriendInput,
  getFriendInput,
  offboardFriendInput,
  reissueTsKeyInput,
  resizeFriendInput,
  resumeFriendInput,
  rotateKeyInput,
  suspendFriendInput,
} from "@p0rt1on/shared/domain";
import { publicProcedure, router } from "../trpc.ts";

/**
 * Friend lifecycle + management. Procedures are thin: validate via the shared
 * zod inputs, delegate to the injected services. `add` and `rotateKey` return a
 * FriendBundle whose secrets are shown once — the client must not persist them.
 */
export const friendsRouter = router({
  /** Dashboard list. */
  list: publicProcedure.query(({ ctx }) => ctx.friendService.list()),

  /** Friend-detail screen (joins friend + instance + activity + latest usage). */
  get: publicProcedure
    .input(getFriendInput)
    .query(({ ctx, input }) => ctx.friendService.get(input.friendId)),

  /** Provision a new friend; returns the once-shown bundle. */
  add: publicProcedure
    .input(addFriendInput)
    .mutation(({ ctx, input }) => ctx.provisioningService.addFriend(input)),

  /**
   * Start provisioning as a background job and return its id immediately. The
   * UI observes per-step progress via `jobs.progress` and claims the once-shown
   * bundle via `jobs.claimBundle` — the work is detached from any connection,
   * so a dropped/reconnected stream can never re-run or orphan it.
   */
  addStart: publicProcedure
    .input(addFriendInput)
    .mutation(({ ctx, input }) => ({
      jobId: ctx.jobService.start(
        "add",
        ctx.provisioningService.addFriendStream(input),
        (bundle) => bundle,
      ),
    })),

  /** Resize the hard quota; effective immediately. */
  resize: publicProcedure
    .input(resizeFriendInput)
    .mutation(({ ctx, input }) =>
      ctx.friendService.resize(input.friendId, input.quotaBytes)
    ),

  /** Rotate the S3 key (also lost-key recovery); returns a fresh once-shown bundle. */
  rotateKey: publicProcedure
    .input(rotateKeyInput)
    .mutation(({ ctx, input }) =>
      ctx.provisioningService.rotateKey(input.friendId)
    ),

  /** Mint a fresh Tailscale enrollment key for the friend's node (shown once). */
  reissueTsKey: publicProcedure
    .input(reissueTsKeyInput)
    .mutation(({ ctx, input }) =>
      ctx.provisioningService.reissueTsKey(input.friendId)
    ),

  /** Disable the user + revoke the node (dedicated may also stop the pair). */
  suspend: publicProcedure
    .input(suspendFriendInput)
    .mutation(({ ctx, input }) => ctx.friendService.suspend(input.friendId)),

  /** Re-enable a suspended friend's S3 user. */
  resume: publicProcedure
    .input(resumeFriendInput)
    .mutation(({ ctx, input }) => ctx.friendService.resume(input.friendId)),

  /** Destructive, mode-aware teardown. Name confirmation is enforced in the UI. */
  offboard: publicProcedure
    .input(offboardFriendInput)
    .mutation(async ({ ctx, input }) => {
      const result = await ctx.provisioningService.offboard(input.friendId);
      return { ok: true as const, ...result };
    }),

  /**
   * Start the destructive teardown as a background job; same observer model as
   * `addStart` (no bundle to claim).
   */
  offboardStart: publicProcedure
    .input(offboardFriendInput)
    .mutation(({ ctx, input }) => ({
      jobId: ctx.jobService.start(
        "offboard",
        ctx.provisioningService.offboardStream(input.friendId),
        undefined,
        (result) => result.manualAclCleanup,
      ),
    })),
});

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
import { protectedProcedure, router } from "../trpc.ts";

/** add and rotateKey return a FriendBundle whose secrets are shown once; the client must never persist them. */
export const friendsRouter = router({
  list: protectedProcedure.query(({ ctx }) => ctx.friendService.list()),

  /** Separate from list so the dashboard renders before this Tailscale call returns. */
  hostnameWarnings: protectedProcedure.query(({ ctx }) =>
    ctx.friendService.hostnameWarnings()
  ),

  get: protectedProcedure
    .input(getFriendInput)
    .query(({ ctx, input }) => ctx.friendService.get(input.friendId)),

  add: protectedProcedure
    .input(addFriendInput)
    .mutation(({ ctx, input }) => ctx.provisioningService.addFriend(input)),

  /** The work is detached from any connection, so a dropped or reconnected stream can never re-run or orphan it. */
  addStart: protectedProcedure
    .input(addFriendInput)
    .mutation(({ ctx, input }) => ({
      jobId: ctx.jobService.start(
        "add",
        ctx.provisioningService.addFriendStream(input),
        (bundle) => bundle,
      ),
    })),

  resize: protectedProcedure
    .input(resizeFriendInput)
    .mutation(({ ctx, input }) =>
      ctx.friendService.resize(input.friendId, input.quotaBytes)
    ),

  rotateKey: protectedProcedure
    .input(rotateKeyInput)
    .mutation(({ ctx, input }) =>
      ctx.provisioningService.rotateKey(input.friendId)
    ),

  /** The minted Tailscale enrollment key is shown once and never persisted, like other secrets. */
  reissueTsKey: protectedProcedure
    .input(reissueTsKeyInput)
    .mutation(({ ctx, input }) =>
      ctx.provisioningService.reissueTsKey(input.friendId)
    ),

  acceptHostname: protectedProcedure
    .input(getFriendInput)
    .mutation(({ ctx, input }) =>
      ctx.provisioningService.acceptHostname(input.friendId)
    ),

  retryHostnameClaim: protectedProcedure
    .input(getFriendInput)
    .mutation(({ ctx, input }) =>
      ctx.provisioningService.retryHostnameClaim(input.friendId)
    ),

  capabilities: protectedProcedure.query(({ ctx }) => ctx.capabilities),

  inviteStatus: protectedProcedure
    .input(getFriendInput)
    .query(({ ctx, input }) =>
      ctx.provisioningService.inviteStatus(input.friendId)
    ),

  resendInvite: protectedProcedure
    .input(getFriendInput)
    .mutation(({ ctx, input }) =>
      ctx.provisioningService.resendInvite(input.friendId)
    ),

  /** Disables the S3 user and revokes any tagged Tailscale node; invite-enrolled
   * friends have no tagged node, so this is credential-only for them. */
  suspend: protectedProcedure
    .input(suspendFriendInput)
    .mutation(({ ctx, input }) => ctx.friendService.suspend(input.friendId)),

  resume: protectedProcedure
    .input(resumeFriendInput)
    .mutation(({ ctx, input }) => ctx.friendService.resume(input.friendId)),

  /** This is a destructive, mode-aware teardown; confirmation is enforced only in the UI, not here. */
  offboard: protectedProcedure
    .input(offboardFriendInput)
    .mutation(async ({ ctx, input }) => {
      const result = await ctx.provisioningService.offboard(input.friendId);
      return { ok: true as const, ...result };
    }),

  offboardStart: protectedProcedure
    .input(offboardFriendInput)
    .mutation(({ ctx, input }) => ({
      jobId: ctx.jobService.start(
        "offboard",
        ctx.provisioningService.offboardStream(input.friendId),
        undefined,
        (result) =>
          [result.manualAclCleanup, result.manualUserRemoval]
            .filter(Boolean).join("\n\n") || undefined,
      ),
    })),
});

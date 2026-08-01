import { createEffect, Show } from "solid-js";
import { createQuery } from "@tanstack/solid-query";
import type { InviteStatus } from "@p0rt1on/shared/domain";
import { Badge } from "./ui/badge.tsx";
import { queryClient, trpc } from "../trpc.ts";
import type { FriendRow } from "./types.ts";

const LABEL: Record<InviteStatus, string> = {
  pending: "Invite pending",
  accepted: "Invite accepted",
  expired: "Invite expired",
  manual: "Invite · manual",
};

// While an invite is pending or manual, this polls Tailscale live and flips to
// accepted without a page refresh. Accepted and expired are terminal, and auth-key friends render nothing.
export function InviteStatusBadge(props: { friend: FriendRow }) {
  const isInvite = () => props.friend.enrollmentMode === "invite";

  const outstanding = () =>
    props.friend.inviteStatus === "pending" ||
    props.friend.inviteStatus === "manual";

  const live = createQuery(() => ({
    queryKey: ["inviteStatus", props.friend.id],
    queryFn: () =>
      trpc.friends.inviteStatus.query({ friendId: props.friend.id }),
    enabled: isInvite() && outstanding(),
  }));

  const status = (): InviteStatus | null =>
    live.data?.status ?? props.friend.inviteStatus;

  // When the live status changes, this invalidates the friends list so the badge and the resend
  // menu item stay in sync; once the list reflects it, the query disables and the effect stops.
  createEffect(() => {
    const fresh = live.data?.status;
    if (fresh && fresh !== props.friend.inviteStatus) {
      queryClient.invalidateQueries({ queryKey: ["friends"] });
    }
  });

  return (
    <Show when={isInvite() && status()}>
      {(s) => <Badge variant="outline">{LABEL[s()]}</Badge>}
    </Show>
  );
}

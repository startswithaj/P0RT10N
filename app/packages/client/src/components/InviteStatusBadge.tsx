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

// Status pill for invite friends. While outstanding (`pending`/`manual`) it reconciles
// against Tailscale on render (endpoint checks OAuth users/devices, persists status), flipping
// to `accepted` without refresh. Accepted/expired terminal; auth-key friends render nothing.
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

  // A reconciled change refreshes the list so the menu's resend item and this badge stay in
  // sync. Converges: once the list reflects the status, the query disables and the effect stops.
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

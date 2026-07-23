import { Show } from "solid-js";
import { DialogShell } from "./DialogShell.tsx";
import { ConfirmActions } from "./ConfirmActions.tsx";
import { createConfirmAction, desc, errText } from "./action-dialog-shared.ts";
import { trpc } from "../trpc.ts";
import type { FriendRow } from "./types.ts";

export function ResendInviteDialog(
  props: { friend: FriendRow; onClose: () => void },
) {
  const { busy, err, confirm } = createConfirmAction({
    run: () => trpc.friends.resendInvite.mutate({ friendId: props.friend.id }),
    success: `Invite resent to ${props.friend.name}`,
    fail: `Couldn't resend the invite for ${props.friend.name}`,
    onDone: props.onClose,
  });

  return (
    <DialogShell
      title={`Resend invite for ${props.friend.name}`}
      onClose={props.onClose}
      onEnter={confirm}
    >
      <p class={desc}>
        Re-sends the Tailscale invite email. Tailscale limits this to once a
        minute — if you just sent one, wait a moment before retrying.
      </p>
      <Show when={err()}>
        <p class={errText}>{err()}</p>
      </Show>
      <ConfirmActions
        confirmLabel="Resend"
        busy={busy()}
        onCancel={props.onClose}
        onConfirm={confirm}
      />
    </DialogShell>
  );
}

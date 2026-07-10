import { Show } from "solid-js";
import { DialogShell } from "./DialogShell.tsx";
import { ConfirmActions } from "./ConfirmActions.tsx";
import { createConfirmAction, desc, errText } from "./action-dialog-shared.ts";
import { trpc } from "../trpc.ts";
import type { FriendRow } from "./types.ts";

export function SuspendDialog(
  props: { friend: FriendRow; onClose: () => void },
) {
  const { busy, err, confirm } = createConfirmAction({
    run: () => trpc.friends.suspend.mutate({ friendId: props.friend.id }),
    success: `Suspended ${props.friend.name}`,
    fail: `Couldn't suspend ${props.friend.name}`,
    onDone: props.onClose,
  });

  return (
    <DialogShell
      title={`Suspend ${props.friend.name}`}
      onClose={props.onClose}
      onEnter={confirm}
    >
      <p class={desc}>
        Disables their S3 user and revokes their node. Data is kept; resume to
        re-enable.
      </p>
      <Show when={err()}>
        <p class={errText}>{err()}</p>
      </Show>
      <ConfirmActions
        confirmLabel="Suspend"
        busy={busy()}
        onCancel={props.onClose}
        onConfirm={confirm}
      />
    </DialogShell>
  );
}

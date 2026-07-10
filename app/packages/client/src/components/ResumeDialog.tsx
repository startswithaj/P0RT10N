import { Show } from "solid-js";
import { DialogShell } from "./DialogShell.tsx";
import { ConfirmActions } from "./ConfirmActions.tsx";
import { createConfirmAction, desc, errText } from "./action-dialog-shared.ts";
import { trpc } from "../trpc.ts";
import type { FriendRow } from "./types.ts";

export function ResumeDialog(
  props: { friend: FriendRow; onClose: () => void },
) {
  const { busy, err, confirm } = createConfirmAction({
    run: () => trpc.friends.resume.mutate({ friendId: props.friend.id }),
    success: `Resumed ${props.friend.name}`,
    fail: `Couldn't resume ${props.friend.name}`,
    onDone: props.onClose,
  });

  return (
    <DialogShell
      title={`Resume ${props.friend.name}`}
      onClose={props.onClose}
      onEnter={confirm}
    >
      <p class={desc}>Re-enables their S3 user.</p>
      <Show when={err()}>
        <p class={errText}>{err()}</p>
      </Show>
      <ConfirmActions
        confirmLabel="Resume"
        busy={busy()}
        onCancel={props.onClose}
        onConfirm={confirm}
      />
    </DialogShell>
  );
}

import { createSignal, Show } from "solid-js";
import * as Field from "./ui/field.tsx";
import { Input } from "./ui/input.tsx";
import { DialogShell } from "./DialogShell.tsx";
import { ConfirmActions } from "./ConfirmActions.tsx";
import { createConfirmAction, desc, errText } from "./action-dialog-shared.ts";
import { trpc } from "../trpc.ts";
import type { FriendRow } from "./types.ts";

const GB = 1_000_000_000;

export function ResizeDialog(
  props: { friend: FriendRow; onClose: () => void },
) {
  // Round to 1 decimal so the field isn't an ugly 1.073741824 (GiB-vs-GB).
  const [qty, setQty] = createSignal(
    Math.round((props.friend.usage.quotaBytes / GB) * 10) / 10,
  );

  const { busy, err, confirm } = createConfirmAction({
    run: () =>
      trpc.friends.resize.mutate({
        friendId: props.friend.id,
        quotaBytes: Math.round(qty() * GB),
      }),
    success: `Resized ${props.friend.name}`,
    fail: `Couldn't resize ${props.friend.name}`,
    onDone: props.onClose,
  });

  return (
    <DialogShell
      title={`Resize ${props.friend.name}`}
      onClose={props.onClose}
      onEnter={() => qty() > 0 && confirm()}
    >
      <p class={desc}>New hard quota — effective immediately.</p>
      <Field.Root>
        <Field.Label>Quota (GB)</Field.Label>
        <Input
          type="number"
          min="1"
          value={qty()}
          onInput={(e) => setQty(Number(e.currentTarget.value))}
        />
      </Field.Root>
      <Show when={err()}>
        <p class={errText}>{err()}</p>
      </Show>
      <ConfirmActions
        confirmLabel="Save"
        busy={busy()}
        disabled={qty() <= 0}
        onCancel={props.onClose}
        onConfirm={confirm}
      />
    </DialogShell>
  );
}

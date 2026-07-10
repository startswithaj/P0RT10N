import { createSignal, Show } from "solid-js";
import { DialogShell } from "./DialogShell.tsx";
import { ConfirmActions } from "./ConfirmActions.tsx";
import {
  type AddBundle,
  desc,
  errText,
  invalidate,
  toastError,
} from "./action-dialog-shared.ts";
import { trpc } from "../trpc.ts";
import type { FriendRow } from "./types.ts";

export function RotateS3Dialog(
  props: {
    friend: FriendRow;
    onClose: () => void;
    onBundle: (b: AddBundle) => void;
  },
) {
  const [busy, setBusy] = createSignal(false);
  const [err, setErr] = createSignal<string | null>(null);

  // Success is the full-screen bundle App shows (the new secret, once) — that's
  // the confirmation, so no success toast here; only failures toast.
  const confirm = async () => {
    if (busy()) return;
    setBusy(true);
    setErr(null);
    try {
      const bundle = await trpc.friends.rotateKey.mutate({
        friendId: props.friend.id,
      });
      props.onBundle(bundle);
      invalidate();
      props.onClose();
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setErr(message);
      toastError(`Couldn't rotate S3 key for ${props.friend.name}`, message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <DialogShell
      title={`Rotate S3 key for ${props.friend.name}`}
      onClose={props.onClose}
      onEnter={confirm}
    >
      <p class={desc}>
        Issues a new S3 key and revokes the current one. Their backups keep
        working once they update the key. The new secret is shown once and can't
        be retrieved again — copy it from the next screen.
      </p>
      <Show when={err()}>
        <p class={errText}>{err()}</p>
      </Show>
      <ConfirmActions
        confirmLabel="Rotate key"
        busy={busy()}
        onCancel={props.onClose}
        onConfirm={confirm}
      />
    </DialogShell>
  );
}

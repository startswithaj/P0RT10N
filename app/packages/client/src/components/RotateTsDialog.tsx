import { createSignal, Show } from "solid-js";
import { Check, Copy } from "lucide-solid";
import { Button } from "./ui/button.tsx";
import { IconButton } from "./ui/icon-button.tsx";
import { DialogShell } from "./DialogShell.tsx";
import { ConfirmActions } from "./ConfirmActions.tsx";
import {
  actionsRow,
  codeBlock,
  codeWrap,
  copyPos,
  desc,
  errText,
  invalidate,
  sparkBtn,
  toastError,
} from "./action-dialog-shared.ts";
import { trpc } from "../trpc.ts";
import type { FriendRow } from "./types.ts";

export function RotateTsDialog(
  props: { friend: FriendRow; onClose: () => void },
) {
  const [busy, setBusy] = createSignal(false);
  const [err, setErr] = createSignal<string | null>(null);
  const [tsCmd, setTsCmd] = createSignal<string | null>(null);
  const [copied, setCopied] = createSignal(false);

  // Success keeps the dialog open showing the once-only key (its own on-screen
  // result), so only failures toast.
  const confirm = async () => {
    if (busy()) return;
    setBusy(true);
    setErr(null);
    try {
      const b = await trpc.friends.reissueTsKey.mutate({
        friendId: props.friend.id,
      });
      invalidate();
      setTsCmd(b.tailscaleUpCommand);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setErr(message);
      toastError(
        `Couldn't re-issue Tailscale key for ${props.friend.name}`,
        message,
      );
    } finally {
      setBusy(false);
    }
  };

  const copy = (v: string) => {
    navigator.clipboard?.writeText(v).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }).catch(() => {});
  };

  return (
    <DialogShell
      title={`Re-issue Tailscale key for ${props.friend.name}`}
      onClose={props.onClose}
      onEnter={tsCmd() ? undefined : confirm}
    >
      <Show
        when={tsCmd()}
        fallback={
          <>
            <p class={desc}>
              Generates a new Tailscale client key so they can reconnect to the
              tailnet. The key is shown once and can't be retrieved again.
            </p>
            <Show when={err()}>
              <p class={errText}>{err()}</p>
            </Show>
            <ConfirmActions
              confirmLabel="Re-issue"
              busy={busy()}
              onCancel={props.onClose}
              onConfirm={confirm}
            />
          </>
        }
      >
        {(cmd) => (
          <>
            <p class={desc}>
              Shown once — run this on {props.friend.name}'s machine:
            </p>
            <div class={codeWrap}>
              <pre class={codeBlock}>{cmd()}</pre>
              <IconButton
                variant="outline"
                size="sm"
                class={copyPos}
                aria-label="Copy"
                onClick={() => copy(cmd())}
              >
                <Show when={copied()} fallback={<Copy size={14} />}>
                  <Check size={14} />
                </Show>
              </IconButton>
            </div>
            <div class={actionsRow}>
              <Button class={sparkBtn} onClick={props.onClose}>
                Done
              </Button>
            </div>
          </>
        )}
      </Show>
    </DialogShell>
  );
}

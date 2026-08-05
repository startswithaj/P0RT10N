import { Show } from "solid-js";
import { Button } from "./ui/button.tsx";
import { LoadingButton } from "./LoadingButton.tsx";
import { DialogShell } from "./DialogShell.tsx";
import {
  actionsRow,
  createConfirmAction,
  desc,
  errText,
  sparkBtn,
} from "./action-dialog-shared.ts";
import { trpc } from "../trpc.ts";
import type { FriendRow } from "./types.ts";

export function HostnameMismatchDialog(
  props: { friend: FriendRow; onClose: () => void },
) {
  const retry = createConfirmAction({
    run: async () => {
      const result = await trpc.friends.retryHostnameClaim.mutate({
        friendId: props.friend.id,
      });
      if (!result.reclaimed) {
        throw new Error(
          `Still held by another device — reachable at ${result.hostname}`,
        );
      }
    },
    success: `Reclaimed the original hostname for ${props.friend.name}`,
    fail: `Couldn't reclaim the hostname for ${props.friend.name}`,
    onDone: props.onClose,
  });

  const accept = createConfirmAction({
    run: () =>
      trpc.friends.acceptHostname.mutate({ friendId: props.friend.id }),
    success: `Accepted the new hostname for ${props.friend.name}`,
    fail: `Couldn't accept the new hostname for ${props.friend.name}`,
    onDone: props.onClose,
  });

  const busy = () => retry.busy() || accept.busy();

  return (
    <DialogShell
      title={`Hostname mismatch — ${props.friend.name}`}
      onClose={props.onClose}
    >
      <p class={desc}>{props.friend.hostnameWarning}</p>
      <p class={desc}>
        Check the Tailscale admin console for what's holding the original
        hostname. If it's stale, remove it there, then retry below. If you'd
        rather keep the current hostname, accepting it repins this portion
        permanently — you'll need to send this friend the updated endpoint
        yourself.
      </p>
      <Show when={retry.err()}>
        <p class={errText}>{retry.err()}</p>
      </Show>
      <Show when={accept.err()}>
        <p class={errText}>{accept.err()}</p>
      </Show>
      <div class={actionsRow}>
        <Button variant="outline" onClick={props.onClose} disabled={busy()}>
          Cancel
        </Button>
        <LoadingButton
          loading={retry.busy()}
          disabled={busy() && !retry.busy()}
          onClick={retry.confirm}
        >
          Retry hostname claim
        </LoadingButton>
        <LoadingButton
          class={sparkBtn}
          loading={accept.busy()}
          disabled={busy() && !accept.busy()}
          onClick={accept.confirm}
        >
          Accept new hostname
        </LoadingButton>
      </div>
    </DialogShell>
  );
}

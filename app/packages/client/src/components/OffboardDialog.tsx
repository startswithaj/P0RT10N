import { createSignal, Match, type Setter, Show, Switch } from "solid-js";
import { Check, Copy } from "lucide-solid";
import { type OffboardStepKey } from "@p0rt1on/shared/steps";
import * as Field from "./ui/field.tsx";
import { Button } from "./ui/button.tsx";
import { IconButton } from "./ui/icon-button.tsx";
import { Input } from "./ui/input.tsx";
import { DialogShell } from "./DialogShell.tsx";
import { ConfirmActions } from "./ConfirmActions.tsx";
import { OffboardProgressBody } from "./OffboardProgressBody.tsx";
import {
  actionsRow,
  codeBlock,
  codeWrap,
  copyPos,
  desc,
  invalidate,
  type OffboardState,
  toastError,
  toastSuccess,
} from "./action-dialog-shared.ts";
import { trpc } from "../trpc.ts";
import type { FriendRow } from "./types.ts";

// Failures arrive as error data events on jobs.progress, and the observer
// stream is replayable, so a reconnect never re-runs teardown.
function subscribeOffboard(
  friend: { id: number; name: string },
  setOffboard: Setter<OffboardState>,
  onDone: () => void,
) {
  setOffboard({ kind: "running", step: null });

  const fail = (message: string, step: OffboardStepKey | null) => {
    toastError(`Couldn't offboard ${friend.name}`, message);
    setOffboard((prev) => ({
      kind: "error",
      message,
      step: step ?? (prev.kind === "running" ? prev.step : null),
    }));
  };

  trpc.friends.offboardStart.mutate({ friendId: friend.id })
    .then(({ jobId }) =>
      trpc.jobs.progress.subscribe({ jobId }, {
        onData: (ev) => {
          // Wire steps are plain strings; the keys come from OFFBOARD_STEPS.
          if (ev.type === "step") {
            setOffboard({ kind: "running", step: ev.step as OffboardStepKey });
          } else if (ev.type === "error") {
            fail(ev.message, ev.step as OffboardStepKey | null);
          } else {
            invalidate();
            // The teardown itself is complete either way, so confirm it now.
            toastSuccess(`Offboarded ${friend.name}`);
            if (ev.manualAclCleanup) {
              setOffboard({ kind: "advice", cleanup: ev.manualAclCleanup });
            } else {
              onDone();
            }
          }
        },
        // Transport-level backstop (e.g. server unreachable mid-observe).
        onError: (err) =>
          fail(err instanceof Error ? err.message : String(err), null),
      })
    )
    .catch((err) =>
      fail(err instanceof Error ? err.message : String(err), null)
    );
}

function AclCleanupBody(props: {
  name: string;
  cleanup: string;
  copied: () => boolean;
  onCopy: (v: string) => void;
  onDismiss: () => void;
}) {
  return (
    <>
      <p class={desc}>
        {props.name}{" "}
        is offboarded. A few follow-ups the manager couldn't do automatically —
        finish these by hand:
      </p>
      <div class={codeWrap}>
        <pre class={codeBlock}>{props.cleanup}</pre>
        <IconButton
          variant="outline"
          size="sm"
          class={copyPos}
          aria-label="Copy"
          onClick={() => props.onCopy(props.cleanup)}
        >
          <Show when={props.copied()} fallback={<Copy size={14} />}>
            <Check size={14} />
          </Show>
        </IconButton>
      </div>
      <div class={actionsRow}>
        <Button variant="outline" onClick={props.onDismiss}>
          Dismiss
        </Button>
      </div>
    </>
  );
}

export function OffboardDialog(
  props: { friend: FriendRow; onClose: () => void },
) {
  const [confirmName, setConfirmName] = createSignal("");
  const [offboard, setOffboard] = createSignal<OffboardState>({ kind: "idle" });
  const [copied, setCopied] = createSignal(false);

  // The typed name is matched verbatim, not case-normalized, matching what the label instructs.
  const canConfirm = () => confirmName() === props.friend.name;
  const running = () => offboard().kind !== "idle";

  const cleanup = () => {
    const s = offboard();
    return s.kind === "advice" ? s.cleanup : null;
  };

  const start = () => {
    if (!canConfirm()) return;
    subscribeOffboard(props.friend, setOffboard, props.onClose);
  };

  const copy = (v: string) => {
    navigator.clipboard?.writeText(v).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }).catch(() => {});
  };

  return (
    <DialogShell
      title={`Offboard ${props.friend.name}`}
      onClose={props.onClose}
      onEnter={running() ? undefined : start}
      wide
    >
      <Switch
        fallback={
          <>
            <p class={desc}>
              This permanently deletes{" "}
              {props.friend.name}'s bucket and all backups. Type the name to
              confirm.
            </p>
            <Field.Root>
              <Field.Label>Type "{props.friend.name}" to confirm</Field.Label>
              <Input
                autocomplete="off"
                value={confirmName()}
                onInput={(e) => setConfirmName(e.currentTarget.value)}
              />
            </Field.Root>
            <ConfirmActions
              confirmLabel="Offboard"
              destructive
              busy={false}
              disabled={!canConfirm()}
              onCancel={props.onClose}
              onConfirm={start}
            />
          </>
        }
      >
        <Match when={cleanup()}>
          {(c) => (
            <AclCleanupBody
              name={props.friend.name}
              cleanup={c()}
              copied={copied}
              onCopy={copy}
              onDismiss={props.onClose}
            />
          )}
        </Match>
        <Match when={running()}>
          <OffboardProgressBody
            name={props.friend.name}
            state={offboard}
            onClose={props.onClose}
          />
        </Match>
      </Switch>
    </DialogShell>
  );
}

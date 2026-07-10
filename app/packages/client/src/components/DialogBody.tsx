import { Match, Show, Switch } from "solid-js";
import { Check, Copy } from "lucide-solid";
import * as Dialog from "./ui/dialog.tsx";
import { Button } from "./ui/button.tsx";
import { IconButton } from "./ui/icon-button.tsx";
import { ConfirmBody } from "./ConfirmBody.tsx";
import { OffboardProgressBody } from "./OffboardProgressBody.tsx";
import {
  actionsRow,
  actionTitle,
  body,
  codeBlock,
  codeWrap,
  copyPos,
  desc,
  type OffboardState,
  type Pending,
  sparkBtn,
} from "./action-dialog-shared.ts";

function TsResultBody(props: {
  name: string;
  cmd: string;
  copied: () => boolean;
  onCopy: (v: string) => void;
  onDone: () => void;
}) {
  return (
    <>
      <p class={desc}>Shown once — run this on {props.name}'s machine:</p>
      <div class={codeWrap}>
        <pre class={codeBlock}>{props.cmd}</pre>
        <IconButton
          variant="outline"
          size="sm"
          class={copyPos}
          aria-label="Copy"
          onClick={() => props.onCopy(props.cmd)}
        >
          <Show when={props.copied()} fallback={<Copy size={14} />}>
            <Check size={14} />
          </Show>
        </IconButton>
      </div>
      <div class={actionsRow}>
        <Button class={sparkBtn} onClick={props.onDone}>
          Done
        </Button>
      </div>
    </>
  );
}

/**
 * Manual ACL mode: the offboard already completed; advise which policy
 * entries the admin should remove by hand. Dismiss just closes — no side
 * effects, nothing depends on the cleanup being done.
 */
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
        is offboarded. You should remove these entries from your tailnet policy
        — the manager can't edit it in manual ACL mode:
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

/**
 * Enter anywhere in the dialog triggers the confirm action (modal
 * convention) — except on a button, which keeps its native activation so
 * Enter on a focused Cancel still cancels. `allowed` gates it to the
 * confirm view with a satisfied precondition (e.g. the offboard name typed).
 */
function confirmOnEnter(allowed: () => boolean, confirm: () => void) {
  return (e: KeyboardEvent) => {
    if (e.key !== "Enter") return;
    if ((e.target as HTMLElement).tagName === "BUTTON") return;
    if (!allowed()) return;
    e.preventDefault();
    confirm();
  };
}

/** The ACL cleanup advice, when the offboard finished in manual ACL mode. */
function aclCleanupOf(s: OffboardState): string | null {
  return s.kind === "advice" ? s.cleanup : null;
}

/** The dialog's inner body: confirm form, or offboard progress, or a TS key. */
export function DialogBody(props: {
  p: Pending;
  qty: () => number;
  setQty: (n: number) => void;
  confirmName: () => string;
  setConfirmName: (s: string) => void;
  err: () => string | null;
  busy: () => boolean;
  canConfirm: () => boolean;
  confirm: () => void;
  offboard: () => OffboardState;
  tsCmd: () => string | null;
  copied: () => boolean;
  copy: (v: string) => void;
  onClose: () => void;
}) {
  // Only while the confirm view is showing (not offboard progress / TS key)
  // and its preconditions hold.
  const enterAllowed = () =>
    props.offboard().kind === "idle" && props.tsCmd() === null &&
    props.canConfirm();
  return (
    <div
      class={body}
      onKeyDown={confirmOnEnter(enterAllowed, props.confirm)}
    >
      <Dialog.Title>{actionTitle(props.p)}</Dialog.Title>
      <Switch
        fallback={
          <ConfirmBody
            p={props.p}
            qty={props.qty}
            setQty={props.setQty}
            confirmName={props.confirmName}
            setConfirmName={props.setConfirmName}
            err={props.err}
            busy={props.busy}
            canConfirm={props.canConfirm}
            onCancel={props.onClose}
            onConfirm={props.confirm}
          />
        }
      >
        <Match when={aclCleanupOf(props.offboard())}>
          {(cleanup) => (
            <AclCleanupBody
              name={props.p.friend.name}
              cleanup={cleanup()}
              copied={props.copied}
              onCopy={props.copy}
              onDismiss={props.onClose}
            />
          )}
        </Match>
        <Match when={props.offboard().kind !== "idle"}>
          <OffboardProgressBody
            name={props.p.friend.name}
            state={props.offboard}
            onClose={props.onClose}
          />
        </Match>
        <Match when={props.tsCmd()}>
          {(cmd) => (
            <TsResultBody
              name={props.p.friend.name}
              cmd={cmd()}
              copied={props.copied}
              onCopy={props.copy}
              onDone={props.onClose}
            />
          )}
        </Match>
      </Switch>
    </div>
  );
}

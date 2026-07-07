import {
  createEffect,
  createSignal,
  Match,
  on,
  type Setter,
  Show,
  Switch,
} from "solid-js";
import { Portal } from "solid-js/web";
import { css } from "styled-system/css";
import { Check, Copy } from "lucide-solid";
import { OFFBOARD_STEPS, type OffboardStepKey } from "@p0rt1on/shared/steps";
import * as Dialog from "./components/ui/dialog.tsx";
import * as Field from "./components/ui/field.tsx";
import { Button } from "./components/ui/button.tsx";
import { IconButton } from "./components/ui/icon-button.tsx";
import { Input } from "./components/ui/input.tsx";
import { StepChecklist, stepStatusFor } from "./components/StepChecklist.tsx";
import { queryClient, trpc } from "./trpc.ts";

type FriendRow = Awaited<ReturnType<typeof trpc.friends.list.query>>[number];
type AddBundle = Awaited<ReturnType<typeof trpc.friends.add.mutate>>;
export type ActionKind =
  | "resize"
  | "rotate-s3"
  | "rotate-ts"
  | "suspend"
  | "resume"
  | "offboard";
export type Pending = { friend: FriendRow; kind: ActionKind };

const GB = 1_000_000_000;
const invalidate = () =>
  queryClient.invalidateQueries({ queryKey: ["friends"] });

// ---- copy (recipe styles the shell; these are the inner bits) ----
function actionTitle(p: Pending): string {
  const n = p.friend.name;
  if (p.kind === "resize") return `Resize ${n}`;
  if (p.kind === "rotate-s3") return `Rotate S3 key for ${n}`;
  if (p.kind === "rotate-ts") return `Re-issue Tailscale key for ${n}`;
  if (p.kind === "suspend") return `Suspend ${n}`;
  if (p.kind === "resume") return `Resume ${n}`;
  return `Offboard ${n}`;
}
function actionDesc(p: Pending): string {
  if (p.kind === "resize") return "New hard quota — effective immediately.";
  if (p.kind === "rotate-s3") {
    return "Issues a new S3 key and revokes the current one. Their backups keep working once they update the key. The new secret is shown once and can't be retrieved again — copy it from the next screen.";
  }
  if (p.kind === "rotate-ts") {
    return "Generates a new Tailscale client key so they can reconnect to the tailnet. The key is shown once and can't be retrieved again.";
  }
  if (p.kind === "suspend") {
    return "Disables their S3 user and revokes their node. Data is kept; resume to re-enable.";
  }
  if (p.kind === "resume") return "Re-enables their S3 user.";
  return `This permanently deletes ${p.friend.name}'s bucket and all backups. Type the name to confirm.`;
}
function confirmLabel(kind: ActionKind): string {
  if (kind === "resize") return "Save";
  if (kind === "rotate-s3") return "Rotate key";
  if (kind === "rotate-ts") return "Re-issue";
  if (kind === "suspend") return "Suspend";
  if (kind === "resume") return "Resume";
  return "Offboard";
}

const body = css({
  display: "flex",
  flexDirection: "column",
  gap: "4",
  p: "6",
  w: "full",
  maxW: "440px",
});
// Softer backdrop than the recipe default (`!` = Panda !important so it wins).
const dimBackdrop = css({ background: "rgba(0, 0, 0, 0.35)!" });
// Lift the panel off the dimmed page — modals should float (shadow > hard border).
const contentShadow = css({
  boxShadow:
    "0 10px 15px -3px rgba(0,0,0,0.5), 0 4px 6px -4px rgba(0,0,0,0.4)!",
});
const desc = css({ fontSize: "sm", color: "fg.muted", lineHeight: "1.5" });
const errText = css({ fontSize: "sm", color: "fg.error" });
const codeWrap = css({ position: "relative" });
const codeBlock = css({
  fontFamily: "body",
  fontSize: "xs",
  lineHeight: "1.7",
  whiteSpace: "pre-wrap",
  wordBreak: "break-all",
  bg: "bg.canvas",
  borderWidth: "1px",
  borderColor: "border.default",
  rounded: "l2",
  p: "3",
  pr: "10",
  color: "fg.default",
});
// Copy sits in the code block's top-right; IconButton supplies the box + hover.
const copyPos = css({ position: "absolute", top: "2", right: "2" });
const actionsRow = css({
  display: "flex",
  justifyContent: "flex-end",
  gap: "3",
  mt: "1",
});
// Primary CTA keeps the brand magenta spark (Park's solid is accent-cyan); the
// Button recipe still supplies sizing, radius and typography.
const sparkBtn = css({
  bg: "spark",
  borderColor: "spark",
  color: "white",
  _hover: { bg: "spark", opacity: "0.9" },
});

type ActionResult =
  | { kind: "done" }
  | { kind: "bundle"; bundle: AddBundle }
  | { kind: "tsCmd"; cmd: string };

/** Live state of the offboard teardown stream (offboard streams; others mutate). */
type OffboardState =
  | { kind: "idle" }
  | { kind: "running"; step: OffboardStepKey | null }
  | { kind: "error"; message: string; step: OffboardStepKey | null };

/** Fire the mutation for an action; returns what the dialog should do next. */
async function dispatchAction(
  p: Pending,
  quotaBytes: number,
): Promise<ActionResult> {
  const friendId = p.friend.id;
  if (p.kind === "resize") {
    await trpc.friends.resize.mutate({ friendId, quotaBytes });
    return { kind: "done" };
  }
  if (p.kind === "suspend") {
    await trpc.friends.suspend.mutate({ friendId });
    return { kind: "done" };
  }
  if (p.kind === "resume") {
    await trpc.friends.resume.mutate({ friendId });
    return { kind: "done" };
  }
  // offboard is handled separately (it streams per-step progress), not here.
  if (p.kind === "rotate-s3") {
    return {
      kind: "bundle",
      bundle: await trpc.friends.rotateKey.mutate({ friendId }),
    };
  }
  const b = await trpc.friends.reissueTsKey.mutate({ friendId });
  return { kind: "tsCmd", cmd: b.tailscaleUpCommand };
}

function ConfirmBody(props: {
  p: Pending;
  qty: () => number;
  setQty: (n: number) => void;
  confirmName: () => string;
  setConfirmName: (s: string) => void;
  err: () => string | null;
  busy: () => boolean;
  canConfirm: () => boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <>
      <p class={desc}>{actionDesc(props.p)}</p>
      <Switch>
        <Match when={props.p.kind === "resize"}>
          <Field.Root>
            <Field.Label>Quota (GB)</Field.Label>
            <Input
              type="number"
              min="1"
              value={props.qty()}
              onInput={(e) => props.setQty(Number(e.currentTarget.value))}
            />
          </Field.Root>
        </Match>
        <Match when={props.p.kind === "offboard"}>
          <Field.Root>
            <Field.Label>Type "{props.p.friend.name}" to confirm</Field.Label>
            <Input
              autocomplete="off"
              value={props.confirmName()}
              onInput={(e) => props.setConfirmName(e.currentTarget.value)}
            />
          </Field.Root>
        </Match>
      </Switch>
      <Show when={props.err()}>
        <p class={errText}>{props.err()}</p>
      </Show>
      <div class={actionsRow}>
        <Button variant="outline" onClick={props.onCancel}>
          Cancel
        </Button>
        <Button
          colorPalette={props.p.kind === "offboard" ? "red" : undefined}
          class={props.p.kind === "offboard" ? undefined : sparkBtn}
          loading={props.busy()}
          disabled={!props.canConfirm()}
          onClick={props.onConfirm}
        >
          {confirmLabel(props.p.kind)}
        </Button>
      </div>
    </>
  );
}

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
 * Start the teardown as a background job, then observe it: drive `setOffboard`
 * per step, close the dialog (refetching the list) on done, or freeze on the
 * step that failed. Failures arrive as `error` DATA events on jobs.progress —
 * the observer stream is replayable, so a reconnect can never re-run teardown.
 */
function subscribeOffboard(
  friendId: number,
  setOffboard: Setter<OffboardState>,
  onDone: () => void,
) {
  setOffboard({ kind: "running", step: null });
  const fail = (message: string, step: OffboardStepKey | null) =>
    setOffboard((prev) => ({
      kind: "error",
      message,
      step: step ?? (prev.kind === "running" ? prev.step : null),
    }));
  trpc.friends.offboardStart.mutate({ friendId })
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
            onDone();
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

const OFFBOARD_LABELS = OFFBOARD_STEPS.map((s) => s.label);

/** Live teardown checklist shown in the dialog once offboarding starts. */
function OffboardProgressBody(props: {
  name: string;
  state: () => OffboardState;
  onClose: () => void;
}) {
  const failed = () => props.state().kind === "error";
  const activeIndex = () => {
    const s = props.state();
    const step = s.kind === "running" || s.kind === "error" ? s.step : null;
    return step === null ? 0 : OFFBOARD_STEPS.findIndex((x) => x.key === step);
  };
  const message = () => {
    const s = props.state();
    return s.kind === "error" ? s.message : null;
  };
  return (
    <>
      <p class={desc}>
        <Show
          when={failed()}
          fallback={`Tearing down ${props.name}'s bucket, keys and node…`}
        >
          Offboarding failed partway — some resources may remain.
        </Show>
      </p>
      <StepChecklist
        steps={OFFBOARD_LABELS}
        status={stepStatusFor(activeIndex(), failed())}
      />
      <Show when={message()}>
        <p class={errText}>{message()}</p>
      </Show>
      <Show when={failed()}>
        <div class={actionsRow}>
          <Button variant="outline" onClick={props.onClose}>
            Close
          </Button>
        </div>
      </Show>
    </>
  );
}

export function ActionDialog(
  props: {
    pending: Pending | null;
    onClose: () => void;
    onBundle: (b: AddBundle) => void;
  },
) {
  const [qty, setQty] = createSignal(0);
  const [confirmName, setConfirmName] = createSignal("");
  const [busy, setBusy] = createSignal(false);
  const [err, setErr] = createSignal<string | null>(null);
  const [tsCmd, setTsCmd] = createSignal<string | null>(null);
  const [copied, setCopied] = createSignal(false);
  const [offboard, setOffboard] = createSignal<OffboardState>({ kind: "idle" });

  // Reset per-open state whenever a new action opens.
  createEffect(on(() => props.pending, (p) => {
    setBusy(false);
    setErr(null);
    setTsCmd(null);
    setConfirmName("");
    setCopied(false);
    setOffboard({ kind: "idle" });
    // Round to 1 decimal so the field isn't an ugly 1.073741824 (GiB-vs-GB).
    setQty(p ? Math.round((p.friend.usage.quotaBytes / GB) * 10) / 10 : 0);
  }));

  const canConfirm = () => {
    const p = props.pending;
    if (!p || busy()) return false;
    if (p.kind === "resize") return qty() > 0;
    if (p.kind === "offboard") {
      // The dialog's label instructs typing the name verbatim ("Type
      // \"{name}\" to confirm"), so match it exactly — not an upper-cased form.
      return confirmName() === p.friend.name;
    }
    return true;
  };

  const confirm = async () => {
    const p = props.pending;
    if (!p) return;
    if (p.kind === "offboard") {
      // streams; dialog stays open showing per-step progress
      subscribeOffboard(p.friend.id, setOffboard, props.onClose);
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const r = await dispatchAction(p, Math.round(qty() * GB));
      if (r.kind === "tsCmd") setTsCmd(r.cmd); // stay open, show the key
      else {
        if (r.kind === "bundle") props.onBundle(r.bundle);
        invalidate();
        props.onClose();
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
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
    <Dialog.Root
      open={props.pending !== null}
      onOpenChange={(d) => !d.open && props.onClose()}
    >
      <Portal>
        <Dialog.Backdrop class={dimBackdrop} />
        <Dialog.Positioner>
          <Dialog.Content class={contentShadow}>
            <Show when={props.pending}>
              {(p) => (
                <DialogBody
                  p={p()}
                  qty={qty}
                  setQty={setQty}
                  confirmName={confirmName}
                  setConfirmName={setConfirmName}
                  err={err}
                  busy={busy}
                  canConfirm={canConfirm}
                  confirm={confirm}
                  offboard={offboard}
                  tsCmd={tsCmd}
                  copied={copied}
                  copy={copy}
                  onClose={props.onClose}
                />
              )}
            </Show>
          </Dialog.Content>
        </Dialog.Positioner>
      </Portal>
    </Dialog.Root>
  );
}

/** The dialog's inner body: confirm form, or offboard progress, or a TS key. */
function DialogBody(props: {
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
  return (
    <div class={body}>
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

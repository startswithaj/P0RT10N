import { createEffect, createSignal, on, type Setter, Show } from "solid-js";
import { Portal } from "solid-js/web";
import { type OffboardStepKey } from "@p0rt1on/shared/steps";
import * as Dialog from "./ui/dialog.tsx";
import { DialogBody } from "./DialogBody.tsx";
import {
  type AddBundle,
  contentShadow,
  dimBackdrop,
  type OffboardState,
  type Pending,
} from "./action-dialog-shared.ts";
import { queryClient, trpc } from "../trpc.ts";
import { toaster } from "./ui/toast.tsx";

export type { ActionKind, Pending } from "./action-dialog-shared.ts";

const GB = 1_000_000_000;

const invalidate = () =>
  queryClient.invalidateQueries({ queryKey: ["friends"] });

/** Past-tense confirmation for a completed action (the success toast title). */
function succeededTitle(p: Pending): string {
  const n = p.friend.name;
  if (p.kind === "resize") return `Resized ${n}`;
  if (p.kind === "suspend") return `Suspended ${n}`;
  if (p.kind === "resume") return `Resumed ${n}`;
  return `Offboarded ${n}`;
}

/** Title for a failed action (the error toast title; the cause is the body). */
function failedTitle(p: Pending): string {
  const n = p.friend.name;
  if (p.kind === "resize") return `Couldn't resize ${n}`;
  if (p.kind === "rotate-s3") return `Couldn't rotate S3 key for ${n}`;
  if (p.kind === "rotate-ts") return `Couldn't re-issue Tailscale key for ${n}`;
  if (p.kind === "suspend") return `Couldn't suspend ${n}`;
  if (p.kind === "resume") return `Couldn't resume ${n}`;
  return `Couldn't offboard ${n}`;
}

const toastSuccess = (title: string) =>
  toaster.create({ title, type: "success" });

const toastError = (title: string, description: string) =>
  toaster.create({ title, description, type: "error" });

type ActionResult =
  | { kind: "done" }
  | { kind: "bundle"; bundle: AddBundle }
  | { kind: "tsCmd"; cmd: string };

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

/**
 * Start the teardown as a background job, then observe it: drive `setOffboard`
 * per step, close the dialog (refetching the list) on done, or freeze on the
 * step that failed. Failures arrive as `error` DATA events on jobs.progress —
 * the observer stream is replayable, so a reconnect can never re-run teardown.
 */
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
            // Manual ACL mode: keep the dialog open with the cleanup advice
            // instead of closing — the offboard itself is already complete.
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
      subscribeOffboard(p.friend, setOffboard, props.onClose);
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const r = await dispatchAction(p, Math.round(qty() * GB));
      if (r.kind === "tsCmd") {
        setTsCmd(r.cmd); // stay open, show the key (its own on-screen result)
      } else {
        // rotate-s3 hands back a full-screen bundle (its own confirmation);
        // the plain resize/suspend/resume close silently, so toast those.
        if (r.kind === "bundle") props.onBundle(r.bundle);
        else toastSuccess(succeededTitle(p));
        invalidate();
        props.onClose();
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setErr(message);
      toastError(failedTitle(p), message);
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

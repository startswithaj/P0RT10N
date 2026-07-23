import { createSignal } from "solid-js";
import { css } from "styled-system/css";
import { OFFBOARD_STEPS, type OffboardStepKey } from "@p0rt1on/shared/steps";
import { queryClient, trpc } from "../trpc.ts";
import { toaster } from "./ui/toast.tsx";

// Shared types, styles and runtime helpers for the per-action dialogs
// (SuspendDialog, ResizeDialog, OffboardDialog, …) and their DialogShell /
// ConfirmActions frame. The dialog shell recipe styles the frame; these are the
// inner bits each dialog composes.

/** Refetch the friends list after a mutation changes it. */
export const invalidate = () =>
  queryClient.invalidateQueries({ queryKey: ["friends"] });

export const toastSuccess = (title: string) =>
  toaster.create({ title, type: "success" });

export const toastError = (title: string, description: string) =>
  toaster.create({ title, description, type: "error" });

/**
 * The confirm flow shared by the plain mutate-then-close dialogs (suspend,
 * resume, resize): run the mutation, toast success + refetch and close on
 * success, or surface the error inline AND as a toast. Tracks `busy`/`err` for
 * the dialog's button + error line.
 */
export function createConfirmAction(opts: {
  run: () => Promise<unknown>;
  success: string;
  fail: string;
  onDone: () => void;
}) {
  const [busy, setBusy] = createSignal(false);
  const [err, setErr] = createSignal<string | null>(null);

  const confirm = async () => {
    if (busy()) return;
    setBusy(true);
    setErr(null);
    try {
      await opts.run();
      toastSuccess(opts.success);
      invalidate();
      opts.onDone();
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setErr(message);
      toastError(opts.fail, message);
    } finally {
      setBusy(false);
    }
  };

  return { busy, err, confirm };
}

type FriendRow = Awaited<ReturnType<typeof trpc.friends.list.query>>[number];
export type AddBundle = Awaited<ReturnType<typeof trpc.friends.add.mutate>>;
export type ActionKind =
  | "resize"
  | "rotate-s3"
  | "rotate-ts"
  | "suspend"
  | "resume"
  | "resend-invite"
  | "offboard";
export type Pending = { friend: FriendRow; kind: ActionKind };

/** Live state of the offboard teardown stream (offboard streams; others mutate). */
export type OffboardState =
  | { kind: "idle" }
  | { kind: "running"; step: OffboardStepKey | null }
  | { kind: "error"; message: string; step: OffboardStepKey | null }
  // Manual ACL mode: teardown finished; the admin should remove the friend's
  // policy entries by hand (advisory, dismissible — never blocking).
  | { kind: "advice"; cleanup: string };

export const OFFBOARD_LABELS = OFFBOARD_STEPS.map((s) => s.label);

export const body = css({
  display: "flex",
  flexDirection: "column",
  gap: "4",
  p: "6",
  w: "full",
  maxW: "440px",
});

// Wider frame for dialogs with code blocks (offboard advice), so paste-in
// snippets don't wrap mid-token.
export const bodyWide = css({
  display: "flex",
  flexDirection: "column",
  gap: "4",
  p: "6",
  w: "full",
  maxW: "560px",
});

// Softer backdrop than the recipe default (`!` = Panda !important so it wins).
export const dimBackdrop = css({ background: "rgba(0, 0, 0, 0.35)!" });

// Lift the panel off the dimmed page — modals should float (shadow > hard border).
export const contentShadow = css({
  boxShadow:
    "0 10px 15px -3px rgba(0,0,0,0.5), 0 4px 6px -4px rgba(0,0,0,0.4)!",
});

export const desc = css({
  fontSize: "sm",
  color: "fg.muted",
  lineHeight: "1.5",
});

export const errText = css({ fontSize: "sm", color: "fg.error" });
export const codeWrap = css({ position: "relative" });

export const codeBlock = css({
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
export const copyPos = css({ position: "absolute", top: "2", right: "2" });

export const actionsRow = css({
  display: "flex",
  justifyContent: "flex-end",
  gap: "3",
  mt: "1",
});

// Primary CTA keeps the brand magenta spark (Park's solid is accent-cyan); the
// Button recipe still supplies sizing, radius and typography.
export const sparkBtn = css({
  bg: "spark",
  borderColor: "spark",
  color: "white",
  _hover: { bg: "spark", opacity: "0.9" },
});

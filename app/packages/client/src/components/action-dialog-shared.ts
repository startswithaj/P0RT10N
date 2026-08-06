import { createSignal } from "solid-js";
import { css } from "styled-system/css";
import { OFFBOARD_STEPS, type OffboardStepKey } from "@p0rt1on/shared/steps";
import { queryClient, trpc } from "../trpc.ts";
import { toaster } from "./ui/toast.tsx";
import type { FriendRow } from "./types.ts";

export const invalidate = () =>
  queryClient.invalidateQueries({ queryKey: ["friends"] });

export const toastSuccess = (title: string) =>
  toaster.create({ title, type: "success" });

export const toastError = (title: string, description: string) =>
  toaster.create({ title, description, type: "error" });

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

export type AddBundle = Awaited<ReturnType<typeof trpc.friends.add.mutate>>;
export type ActionKind =
  | "resize"
  | "rotate-s3"
  | "rotate-ts"
  | "suspend"
  | "resume"
  | "resend-invite"
  | "offboard"
  | "hostname-issue";
export type Pending = { friend: FriendRow; kind: ActionKind };

/** Offboard streams progress; the other dialogs' actions just mutate. */
export type OffboardState =
  | { kind: "idle" }
  | { kind: "running"; step: OffboardStepKey | null }
  | { kind: "error"; message: string; step: OffboardStepKey | null }
  // Manual ACL mode: teardown is already finished; this is advisory and
  // dismissible, never blocking.
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

export const copyPos = css({ position: "absolute", top: "2", right: "2" });

export const actionsRow = css({
  display: "flex",
  justifyContent: "flex-end",
  gap: "3",
  mt: "1",
});

export const sparkBtn = css({
  bg: "spark",
  borderColor: "spark",
  color: "white",
  _hover: { bg: "spark", opacity: "0.9" },
});

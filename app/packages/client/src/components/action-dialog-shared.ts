import { css } from "styled-system/css";
import { OFFBOARD_STEPS, type OffboardStepKey } from "@p0rt1on/shared/steps";
import { trpc } from "../trpc.ts";

// Shared types, copy and styles for the ActionDialog family (ActionDialog +
// DialogBody + the per-mode body components). The dialog shell recipe styles the
// frame; these are the inner bits.

type FriendRow = Awaited<ReturnType<typeof trpc.friends.list.query>>[number];
export type AddBundle = Awaited<ReturnType<typeof trpc.friends.add.mutate>>;
export type ActionKind =
  | "resize"
  | "rotate-s3"
  | "rotate-ts"
  | "suspend"
  | "resume"
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

export function actionTitle(p: Pending): string {
  const n = p.friend.name;
  if (p.kind === "resize") return `Resize ${n}`;
  if (p.kind === "rotate-s3") return `Rotate S3 key for ${n}`;
  if (p.kind === "rotate-ts") return `Re-issue Tailscale key for ${n}`;
  if (p.kind === "suspend") return `Suspend ${n}`;
  if (p.kind === "resume") return `Resume ${n}`;
  return `Offboard ${n}`;
}
export function actionDesc(p: Pending): string {
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
export function confirmLabel(kind: ActionKind): string {
  if (kind === "resize") return "Save";
  if (kind === "rotate-s3") return "Rotate key";
  if (kind === "rotate-ts") return "Re-issue";
  if (kind === "suspend") return "Suspend";
  if (kind === "resume") return "Resume";
  return "Offboard";
}

export const OFFBOARD_LABELS = OFFBOARD_STEPS.map((s) => s.label);

export const body = css({
  display: "flex",
  flexDirection: "column",
  gap: "4",
  p: "6",
  w: "full",
  maxW: "440px",
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

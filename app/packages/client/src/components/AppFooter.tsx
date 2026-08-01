import { Show } from "solid-js";
import { css } from "styled-system/css";
import { GitCommitHorizontal, LogOut } from "lucide-solid";
import { Button } from "./ui/button.tsx";
import { Wordmark } from "./Wordmark.tsx";
import type { SystemHealth } from "./helpers.ts";

declare const __COMMIT__: string; // injected by Vite (short git hash, or "dev")

const footer = css({
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  borderTopWidth: "1px",
  borderColor: "border.default",
  mt: "12",
  py: "6",
  gap: "3",
  flexWrap: "wrap",
});

const footerNote = css({
  display: "inline-flex",
  alignItems: "center",
  gap: "2",
  fontSize: "xs",
  color: "fg.muted",
  letterSpacing: "0.1em",
  textTransform: "uppercase",
});

const dotUp = css({ w: "2", h: "2", rounded: "full", bg: "cyan.9" });
const dotDown = css({ w: "2", h: "2", rounded: "full", bg: "fg.error" });

// Offboarding uses a pulsing warning dot because teardown is in progress, not a fault.
const dotOffboarding = css({
  w: "2",
  h: "2",
  rounded: "full",
  bg: "warning",
  animation: "pulse 1.4s ease-in-out infinite",
});

// This stays on variant=plain rather than link because plain allows px:1 while
// link forces it to 0, so plain's gray hover and active washes are neutralized here.
const footerStatusBtn = css({
  h: "auto",
  px: "1",
  gap: "1.5",
  fontSize: "xs",
  letterSpacing: "0.1em",
  textTransform: "uppercase",
  color: "fg.muted",
  bg: "transparent",
  _hover: { color: "fg.default", bg: "transparent" },
  _active: { bg: "transparent" },
  _on: { bg: "transparent" },
});

const version = css({ display: "inline-flex", alignItems: "center", gap: "1" });

function healthLabel(h: SystemHealth): string {
  if (h === "unhealthy") return "Unhealthy";
  if (h === "offboarding") return "Offboarding";
  if (h === "checking") return "Checking…";
  return "Healthy";
}

function healthDot(h: SystemHealth): string {
  if (h === "unhealthy") return dotDown;
  if (h === "offboarding") return dotOffboarding;
  return dotUp;
}

export function AppFooter(
  props: {
    health: () => SystemHealth;
    onStatus: () => void;
    /** Present only when auth is enabled — renders a log-out button. */
    onLogout?: () => void;
  },
) {
  return (
    <footer class={footer}>
      <Wordmark size={16} />
      <span class={footerNote}>
        <Button
          variant="plain"
          size="xs"
          class={footerStatusBtn}
          onClick={() => props.onStatus()}
        >
          <span class={healthDot(props.health())} />
          {healthLabel(props.health())}
        </Button>
        {" · "}
        <span class={version}>
          <GitCommitHorizontal size={12} /> {__COMMIT__}
        </span>
        <Show when={props.onLogout}>
          {" · "}
          <Button
            variant="plain"
            size="xs"
            class={footerStatusBtn}
            onClick={() => props.onLogout?.()}
          >
            <LogOut size={12} /> Log out
          </Button>
        </Show>
      </span>
    </footer>
  );
}

import { Show } from "solid-js";
import { css } from "styled-system/css";
import { GitCommitHorizontal, LogOut } from "lucide-solid";
import { Button } from "./ui/button.tsx";
import { Wordmark } from "./Wordmark.tsx";

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
// The footer health chip is a link to the Status page (which shows the issue).
// Stays on variant=plain (it wants px:1, which `link` forces to 0!) — so all
// of plain's gray washes are neutralised here, like segBtn.
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
// The commit chip: git icon + short hash, aligned with the muted note text.
const version = css({ display: "inline-flex", alignItems: "center", gap: "1" });

function healthLabel(h: "healthy" | "unhealthy" | "checking"): string {
  if (h === "unhealthy") return "Unhealthy";
  if (h === "checking") return "Checking…";
  return "Healthy";
}

export function AppFooter(
  props: {
    health: () => "healthy" | "unhealthy" | "checking";
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
          <span class={props.health() === "unhealthy" ? dotDown : dotUp} />
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

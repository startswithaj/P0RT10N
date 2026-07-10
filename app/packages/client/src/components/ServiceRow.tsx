import { type JSX, Show } from "solid-js";
import { css } from "styled-system/css";
import { ChevronDown, ChevronRight } from "lucide-solid";
import { stateLabel, type Svc, type SvcState } from "./status-types.ts";
import { DiagnosticsPanel } from "./DiagnosticsPanel.tsx";

// One status list item. Rows with an `instance` expand into a DiagnosticsPanel.

const row = css({
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: "4",
  bg: "bg.default",
  borderWidth: "1px",
  borderColor: "border.default",
  rounded: "l2",
  px: "4",
  py: "3",
  // `sm` (not `lg`): rows are dense list items — texture, not elevation, so
  // they don't compete with the stat cards above.
  boxShadow: "sm",
});
const rowClickable = css({
  cursor: "pointer",
  _hover: { borderColor: "border.outline" },
});
const rowLeft = css({
  display: "flex",
  alignItems: "center",
  gap: "3",
  minW: "0",
});
const rowRight = css({ display: "flex", alignItems: "center", gap: "3" });
const rowIcon = css({
  display: "grid",
  placeItems: "center",
  w: "9",
  h: "9",
  rounded: "l2",
  borderWidth: "1px",
  borderColor: "border.default",
  color: "cyan.9",
  flexShrink: "0",
});
const rowName = css({ fontWeight: "bold", fontSize: "sm" });
const rowSub = css({ color: "fg.muted", fontSize: "xs" });
const chevron = css({ color: "fg.muted", display: "inline-flex" });
const statusPill = css({
  display: "inline-flex",
  alignItems: "center",
  gap: "2",
  fontSize: "xs",
  fontWeight: "bold",
  letterSpacing: "0.06em",
  textTransform: "uppercase",
  flexShrink: "0",
});
const dotUp = css({ w: "2", h: "2", rounded: "full", bg: "cyan.9" });
const dotDown = css({ w: "2", h: "2", rounded: "full", bg: "fg.error" });
const dotProv = css({
  w: "2",
  h: "2",
  rounded: "full",
  bg: "warning",
  animation: "pulse 1.4s ease-in-out infinite",
});
const upText = css({ color: "cyan.11" });
const downText = css({ color: "fg.error" });
const provText = css({ color: "warning" });

function stateColor(s: SvcState): string {
  if (s === "up") return upText;
  if (s === "provisioning") return provText;
  return downText;
}

function stateDot(s: SvcState): string {
  if (s === "up") return dotUp;
  if (s === "provisioning") return dotProv;
  return dotDown;
}

export function ServiceRow(
  props: {
    svc: Svc;
    icon: () => JSX.Element;
    expanded: () => string | null;
    setExpanded: (k: string | null) => void;
  },
) {
  const key = () => props.svc.instance ?? "";
  const clickable = () => key().length > 0;
  const isOpen = () => clickable() && props.expanded() === key();
  return (
    <div>
      <div
        class={`${row} ${clickable() ? rowClickable : ""}`}
        onClick={() =>
          clickable() && props.setExpanded(isOpen() ? null : key())}
      >
        <div class={rowLeft}>
          <div class={rowIcon}>{props.icon()}</div>
          <div>
            <div class={rowName}>{props.svc.name}</div>
            <div class={rowSub}>{props.svc.detail}</div>
          </div>
        </div>
        <div class={rowRight}>
          <span class={`${statusPill} ${stateColor(props.svc.state)}`}>
            <span class={stateDot(props.svc.state)} />
            {stateLabel(props.svc.state)}
          </span>
          <Show when={clickable()}>
            <span class={chevron}>
              <Show when={isOpen()} fallback={<ChevronRight size={16} />}>
                <ChevronDown size={16} />
              </Show>
            </span>
          </Show>
        </div>
      </div>
      <Show when={isOpen()}>
        <DiagnosticsPanel instance={key()} />
      </Show>
    </div>
  );
}

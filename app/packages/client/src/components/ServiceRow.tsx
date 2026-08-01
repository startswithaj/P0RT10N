import { type JSX, Show } from "solid-js";
import { css } from "styled-system/css";
import { ChevronDown, ChevronRight } from "lucide-solid";
import { stateLabel, type Svc, type SvcState } from "./status-types.ts";
import { DiagnosticsPanel } from "./DiagnosticsPanel.tsx";
import { Sparkline } from "./Sparkline.tsx";
import { Tooltip } from "./ui/tooltip.tsx";

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
  // This uses `sm` rather than `lg` because rows are dense list items that
  // want texture, not elevation, so they don't compete with the stat cards above.
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

const rowRight = css({
  display: "flex",
  alignItems: "center",
  gap: "3",
  // The sparkline's tooltip trigger is a button whose reset cursor overrides
  // the row's clickable hand, so this re-inherits it to keep one cursor.
  "& button": { cursor: "inherit" },
});

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
  // `pending` (reaping) is transient like provisioning, not a real down state.
  if (s === "provisioning" || s === "pending") return provText;
  return downText;
}

function stateDot(s: SvcState): string {
  if (s === "up") return dotUp;
  if (s === "provisioning" || s === "pending") return dotProv;
  return dotDown;
}

function sparkLabel(data: number[]): string {
  const total = data.reduce((sum, n) => sum + n, 0);
  if (total === 0) return "No activity · last 24h";
  return `${total} request${total === 1 ? "" : "s"} · last 24h`;
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
          <Show when={props.svc.spark}>
            {(spark) => (
              <Tooltip
                content={sparkLabel(spark())}
                openDelay={300}
                closeDelay={100}
                positioning={{ placement: "top" }}
              >
                <Sparkline data={spark()} />
              </Tooltip>
            )}
          </Show>
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

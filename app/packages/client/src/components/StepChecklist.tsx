import { For, Show } from "solid-js";
import { css } from "styled-system/css";
import { CircleCheck, LoaderCircle, XCircle } from "lucide-solid";

export type StepStatus = "done" | "active" | "failed" | "pending";

const list = css({ display: "flex", flexDirection: "column" });

const row = css({
  display: "flex",
  alignItems: "center",
  gap: "3",
  px: "3",
  py: "3",
  rounded: "l2",
  fontSize: "sm",
});

// Dark mode: slate reads muddy on indigo, so use a faint spark (magenta) tint instead of bg.muted.
const rowActive = css({ bg: "bg.muted", _dark: { bg: "spark/12" } });

const iconWrap = css({
  display: "grid",
  placeItems: "center",
  w: "5",
  h: "5",
  flexShrink: "0",
});

const spin = css({
  animation: "spin 0.8s linear infinite",
  color: "cyan.9",
});

const pendingDot = css({
  w: "4",
  h: "4",
  rounded: "full",
  borderWidth: "2px",
  borderColor: "border.default",
});

const doneIcon = css({ color: "cyan.9" });
const errorMark = css({ color: "fg.error" });
const labelDone = css({ color: "fg.default" });
const labelActive = css({ color: "fg.default", fontWeight: "bold" });
const labelFailed = css({ color: "fg.error", fontWeight: "bold" });
const labelPending = css({ color: "fg.muted" });

function labelClass(status: StepStatus): string {
  if (status === "done") return labelDone;
  if (status === "active") return labelActive;
  if (status === "failed") return labelFailed;
  return labelPending;
}

export function StepChecklist(
  props: { steps: string[]; status: (index: number) => StepStatus },
) {
  return (
    <div class={list}>
      <For each={props.steps}>
        {(step, i) => {
          const status = () => props.status(i());
          return (
            <div class={`${row} ${status() === "active" ? rowActive : ""}`}>
              <span class={iconWrap}>
                <Show when={status() === "done"}>
                  <CircleCheck size={18} class={doneIcon} />
                </Show>
                <Show when={status() === "active"}>
                  <LoaderCircle size={18} class={spin} />
                </Show>
                <Show when={status() === "failed"}>
                  <XCircle size={18} class={errorMark} />
                </Show>
                <Show when={status() === "pending"}>
                  <span class={pendingDot} />
                </Show>
              </span>
              <span class={labelClass(status())}>{step}</span>
            </div>
          );
        }}
      </For>
    </div>
  );
}

/**
 * Builds a per-index status function from the active step index and whether it failed.
 * Indexes before the active one are done, the active index is active or failed, and later indexes are pending.
 */
export function stepStatusFor(
  activeIndex: number,
  failed: boolean,
): (index: number) => StepStatus {
  return (index) => {
    if (index < activeIndex) return "done";
    if (index > activeIndex) return "pending";
    return failed ? "failed" : "active";
  };
}

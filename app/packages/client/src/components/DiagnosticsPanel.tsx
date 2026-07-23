import { createQuery } from "@tanstack/solid-query";
import { Show } from "solid-js";
import { css } from "styled-system/css";
import { trpc } from "../trpc.ts";
import { pollMs } from "./helpers.ts";

// Live per-instance diagnostics (`status.diagnose`): state, health reason, exit,
// recent logs. Rendered inside an expanded ServiceRow.

const panel = css({
  bg: "bg.canvas",
  borderWidth: "1px",
  borderColor: "border.default",
  rounded: "l2",
  mt: "1",
  px: "4",
  py: "3",
  display: "flex",
  flexDirection: "column",
  gap: "2",
});

const panelMeta = css({
  display: "flex",
  flexWrap: "wrap",
  gap: "4",
  fontSize: "xs",
});

const panelKey = css({
  color: "fg.muted",
  textTransform: "uppercase",
  letterSpacing: "0.08em",
  mr: "1.5",
});

const panelReason = css({ fontSize: "xs", color: "fg.default" });

const panelLogs = css({
  fontFamily: "body",
  fontSize: "xs",
  lineHeight: "1.6",
  whiteSpace: "pre-wrap",
  wordBreak: "break-all",
  color: "fg.muted",
  bg: "bg.default",
  borderWidth: "1px",
  borderColor: "border.default",
  rounded: "l2",
  p: "3",
  maxH: "60",
  overflowY: "auto",
});

const panelMutedText = css({ color: "fg.muted", fontSize: "xs" });

export function DiagnosticsPanel(props: { instance: string }) {
  const diag = createQuery(() => ({
    queryKey: ["diagnose", props.instance],
    queryFn: () => trpc.status.diagnose.query({ instanceName: props.instance }),
    refetchInterval: pollMs(5000),
    retry: false,
  }));
  return (
    <div class={panel}>
      <Show
        when={diag.data}
        fallback={
          <span class={panelMutedText}>
            {diag.isError ? "Diagnostics unavailable." : "Loading diagnostics…"}
          </span>
        }
      >
        {(d) => (
          <>
            <div class={panelMeta}>
              <span>
                <span class={panelKey}>State</span>
                {d().state}
              </span>
              <span>
                <span class={panelKey}>Health</span>
                {d().health}
              </span>
              <Show when={d().exitCode !== null}>
                <span>
                  <span class={panelKey}>Exit</span>
                  {d().exitCode} {d().exitError}
                </span>
              </Show>
            </div>
            <Show when={d().healthReason}>
              <div class={panelReason}>⚠ {d().healthReason}</div>
            </Show>
            <pre class={panelLogs}>{d().recentLogs || "(no logs)"}</pre>
          </>
        )}
      </Show>
    </div>
  );
}

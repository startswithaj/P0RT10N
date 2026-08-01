import { createSignal, For, Show } from "solid-js";
import { css } from "styled-system/css";
import { AlertTriangle, RefreshCw } from "lucide-solid";
import { LoadingButton } from "./LoadingButton.tsx";
import type { SystemHealth } from "@p0rt1on/shared/domain";

const banner = css({
  display: "flex",
  alignItems: "flex-start",
  gap: "3",
  bg: "bg.default",
  color: "fg.default",
  borderBottomWidth: "2px",
  borderColor: "warning",
  px: "4",
  py: "3",
  fontSize: "sm",
});

const icon = css({ color: "warning", flexShrink: 0, mt: "0.5" });

const body = css({
  display: "flex",
  flexDirection: "column",
  gap: "1.5",
  flex: "1",
});

const header = css({
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: "3",
});

const link = css({ color: "warning", textDecoration: "underline" });

// This banner isn't dismissible, and a `blocked` check also disables the Add portion button elsewhere.
export function SystemHealthBanner(
  props: {
    report: () => SystemHealth | undefined;
    onRetry: () => Promise<void>;
  },
) {
  const [rechecking, setRechecking] = createSignal(false);

  const problems = () =>
    (props.report()?.checks ?? []).filter((c) => c.status !== "ok");

  const retry = () => {
    setRechecking(true);
    props.onRetry().finally(() => setRechecking(false));
  };

  return (
    <Show when={problems().length > 0}>
      <div class={banner}>
        <AlertTriangle size={18} class={icon} />
        <div class={body}>
          <div class={header}>
            <strong>System health — fix before adding portions</strong>
            <LoadingButton
              size="xs"
              variant="outline"
              onClick={retry}
              loading={rechecking()}
            >
              <RefreshCw size={14} /> Re-check
            </LoadingButton>
          </div>
          <For each={problems()}>
            {(check) => (
              <span>
                <strong>{check.title}</strong> — {check.detail}{" "}
                <Show when={check.fixUrl}>
                  {(url) => (
                    <a
                      href={url()}
                      target="_blank"
                      rel="noopener noreferrer"
                      class={link}
                    >
                      Open Tailscale settings ↗
                    </a>
                  )}
                </Show>
              </span>
            )}
          </For>
        </div>
      </div>
    </Show>
  );
}

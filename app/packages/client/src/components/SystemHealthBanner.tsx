import { createSignal, For, Show } from "solid-js";
import { css } from "styled-system/css";
import { AlertTriangle, RefreshCw, X } from "lucide-solid";
import { LoadingButton } from "./LoadingButton.tsx";
import { IconButton } from "./ui/icon-button.tsx";
import type { HealthCheck, SystemHealth } from "@p0rt1on/shared/domain";

const banner = css({
  display: "flex",
  alignItems: "flex-start",
  gap: "3",
  bg: "bg.default",
  color: "fg.default",
  borderBottomWidth: "2px",
  px: "4",
  py: "3",
  fontSize: "sm",
});

// A blocked check disables Add portion, so it must not look like advice.
const blockedEdge = css({ borderColor: "fg.error" });
const warnEdge = css({ borderColor: "warning" });
const blockedIcon = css({ color: "fg.error", flexShrink: 0, mt: "0.5" });
const warnIcon = css({ color: "warning", flexShrink: 0, mt: "0.5" });

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

const row = css({
  display: "flex",
  alignItems: "flex-start",
  justifyContent: "space-between",
  gap: "2",
});

const link = css({ color: "warning", textDecoration: "underline" });

const DISMISSED_KEY = "p0rt1on.health.dismissed";

/** Keyed on the message, not just the id, so a check that starts saying
 * something different comes back rather than staying silently dismissed. */
function checkKey(check: HealthCheck): string {
  return `${check.id}::${check.detail}`;
}

function loadDismissed(): string[] {
  try {
    const raw = localStorage.getItem(DISMISSED_KEY);
    return raw ? JSON.parse(raw) as string[] : [];
  } catch {
    return []; // corrupt or unavailable storage just means nothing is dismissed
  }
}

/**
 * `blocked` checks can never be dismissed — they disable the Add portion
 * button, and hiding one would leave that button dead with no visible reason.
 * `warn` checks can, because several of them fire on configurations that are
 * correct and permanent (PSA `restricted` is the intended posture), and a
 * banner that is always present is a banner people stop reading.
 */
export function SystemHealthBanner(
  props: {
    report: () => SystemHealth | undefined;
    onRetry: () => Promise<void>;
  },
) {
  const [rechecking, setRechecking] = createSignal(false);
  const [dismissed, setDismissed] = createSignal<string[]>(loadDismissed());

  const problems = () =>
    (props.report()?.checks ?? []).filter((c) => c.status !== "ok");

  const visible = () =>
    problems().filter((c) =>
      c.status === "blocked" || !dismissed().includes(checkKey(c))
    );

  const blocking = () => visible().some((c) => c.status === "blocked");

  const dismiss = (check: HealthCheck) => {
    const next = [...dismissed(), checkKey(check)];
    setDismissed(next);
    try {
      localStorage.setItem(DISMISSED_KEY, JSON.stringify(next));
    } catch (err) {
      // Storage unavailable (private mode, quota): the dismissal still applies
      // for this session, it just won't survive a reload.
      console.warn("could not persist health-check dismissal", err);
    }
  };

  const retry = () => {
    setRechecking(true);
    props.onRetry().finally(() => setRechecking(false));
  };

  return (
    <Show when={visible().length > 0}>
      <div class={`${banner} ${blocking() ? blockedEdge : warnEdge}`}>
        <AlertTriangle
          size={18}
          class={blocking() ? blockedIcon : warnIcon}
        />
        <div class={body}>
          <div class={header}>
            <Show
              when={blocking()}
              fallback={<strong>System health — advisories</strong>}
            >
              <strong>System health — fix before adding portions</strong>
            </Show>
            <LoadingButton
              size="xs"
              variant="outline"
              onClick={retry}
              loading={rechecking()}
            >
              <RefreshCw size={14} /> Re-check
            </LoadingButton>
          </div>
          <For each={visible()}>
            {(check) => (
              <div class={row}>
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
                <Show when={check.status !== "blocked"}>
                  <IconButton
                    size="xs"
                    variant="plain"
                    aria-label={`Dismiss ${check.title}`}
                    onClick={() => dismiss(check)}
                  >
                    <X size={14} />
                  </IconButton>
                </Show>
              </div>
            )}
          </For>
        </div>
      </div>
    </Show>
  );
}

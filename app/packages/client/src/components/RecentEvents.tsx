import { createQuery } from "@tanstack/solid-query";
import { createSignal, For, Show } from "solid-js";
import { css } from "styled-system/css";
import type { AuditAction, AuditEntryView } from "@p0rt1on/shared/domain";
import { trpc } from "../trpc.ts";
import { Button } from "./ui/button.tsx";
import { Tooltip } from "./ui/tooltip.tsx";
import { pollMs, relativeTime } from "./helpers.ts";

// Audit trail on the Status page: every lifecycle event (add, suspend, rotate,
// offboard, boot-time instance_recovered/instance_data_lost), newest first.

const section = css({ mb: "8" });

const sectionTitle = css({
  fontFamily: "display",
  fontSize: "lg",
  color: "fg.default",
  mb: "4",
});

const list = css({ display: "flex", flexDirection: "column", gap: "2" });
const empty = css({ color: "fg.muted", fontSize: "sm" });

const eventRow = css({
  display: "flex",
  alignItems: "baseline",
  gap: "3",
  bg: "bg.default",
  borderWidth: "1px",
  borderColor: "border.default",
  rounded: "l2",
  px: "4",
  py: "3",
  boxShadow: "sm",
});

const eventDotBase = { w: "2", h: "2", rounded: "full", flexShrink: "0" };
const eventDotRed = css({ ...eventDotBase, bg: "fg.error" });
const eventDotAmber = css({ ...eventDotBase, bg: "warning" });
const eventDotNeutral = css({ ...eventDotBase, bg: "cyan.9" });

// The portion name leads as the subject (bold); the action follows, muted.
const eventFriend = css({
  fontWeight: "bold",
  fontSize: "sm",
  flexShrink: "0",
});

const eventAction = css({
  color: "fg.muted",
  fontSize: "sm",
  flexShrink: "0",
});

const eventWhen = css({ color: "fg.muted", fontSize: "xs", flexShrink: "0" });

const eventDetail = css({
  color: "fg.muted",
  fontSize: "xs",
  ml: "auto",
  textAlign: "right",
  minW: "0",
});

const loadOlder = css({ mt: "3" });

// Human label per audit action. Exhaustive: adding an AuditAction without a
// label here is a compile error, so the UI can never show a raw code.
const ACTION_LABELS: Record<AuditAction, string> = {
  add_friend: "Added",
  resize: "Resized",
  rotate_key: "Rotated key",
  reissue_ts_key: "Reissued key",
  suspend: "Suspended",
  resume: "Resumed",
  offboard: "Offboarded",
  instance_recovered: "Recovered",
  instance_data_lost: "Data lost",
  login: "Signed in",
  logout: "Signed out",
  action_failed: "Failed",
};

function eventDot(action: AuditAction): string {
  if (action === "instance_data_lost" || action === "action_failed") {
    return eventDotRed;
  }
  if (action === "instance_recovered" || action === "suspend") {
    return eventDotAmber;
  }
  return eventDotNeutral;
}

// SQLite datetime('now') → "2026-07-22 10:30:00" (UTC, no timezone marker).
function parseWhen(when: string): number {
  return Date.parse(`${when.replace(" ", "T")}Z`);
}

function whenAgo(when: string): string {
  const ms = parseWhen(when);
  return Number.isNaN(ms) ? when : relativeTime(Date.now() - ms);
}

/** The exact local timestamp for the hover tooltip. */
function whenExact(when: string): string {
  const ms = parseWhen(when);
  return Number.isNaN(ms) ? when : new Date(ms).toLocaleString();
}

export function RecentEvents() {
  // Grow the window rather than cursor-page: this panel tops out at the
  // newest 100.
  const [limit, setLimit] = createSignal(20);
  const events = createQuery(() => ({
    queryKey: ["audit", limit()],
    queryFn: () => trpc.audit.list.query({ limit: limit() }),
    refetchInterval: pollMs(10000),
    retry: false,
  }));
  const entries = (): AuditEntryView[] => events.data ?? [];
  const canLoadOlder = () => limit() < 100 && entries().length === limit();

  return (
    <div class={section}>
      <h2 class={sectionTitle}>Recent events</h2>
      <div class={list}>
        <Show
          when={entries().length}
          fallback={<span class={empty}>No events yet.</span>}
        >
          <For each={entries()}>
            {(e) => (
              <div class={eventRow}>
                <span class={eventDot(e.action)} />
                <span class={eventFriend}>{e.friend ?? "system"}</span>
                <span class={eventAction}>{ACTION_LABELS[e.action]}</span>
                <Tooltip
                  content={whenExact(e.when)}
                  openDelay={300}
                  closeDelay={100}
                  positioning={{ placement: "top" }}
                >
                  <span class={eventWhen}>{whenAgo(e.when)}</span>
                </Tooltip>
                <Show when={e.detail}>
                  <span class={eventDetail}>{e.detail}</span>
                </Show>
              </div>
            )}
          </For>
        </Show>
      </div>
      <Show when={canLoadOlder()}>
        <div class={loadOlder}>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setLimit(limit() + 20)}
          >
            Load older
          </Button>
        </div>
      </Show>
    </div>
  );
}

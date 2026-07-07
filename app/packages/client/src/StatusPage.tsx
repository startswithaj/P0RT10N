import { createQuery } from "@tanstack/solid-query";
import { createSignal, For, type JSX, Show } from "solid-js";
import { css } from "styled-system/css";
import {
  ChevronDown,
  ChevronRight,
  Database,
  Network,
  Server,
} from "lucide-solid";
import { trpc } from "./trpc.ts";

// System status, polled live from `status.get`. Instance rows expand into live
// diagnostics (`status.diagnose`): state, health reason, exit, recent logs.

type SvcState = "up" | "provisioning" | "down";
type Svc = { name: string; detail: string; state: SvcState; instance?: string };

function stateLabel(s: SvcState): string {
  if (s === "up") return "Up";
  if (s === "provisioning") return "Provisioning";
  return "Down";
}
type View = { minio: Svc[]; tailscale: Svc[]; host: Svc[] };

const statGrid = css({
  display: "grid",
  gridTemplateColumns: { base: "1fr", sm: "repeat(3, 1fr)" },
  gap: "4",
  mt: "8",
  mb: "10",
});
const card = css({
  bg: "bg.default",
  borderWidth: "1px",
  borderColor: "border.default",
  rounded: "l3",
  p: "5",
  boxShadow: "lg",
});
const statTop = css({
  display: "flex",
  alignItems: "center",
  gap: "2",
  color: "fg.muted",
  fontSize: "xs",
  letterSpacing: "0.16em",
  textTransform: "uppercase",
  mb: "3",
});
const statValue = css({
  fontSize: "2xl",
  fontWeight: "bold",
  lineHeight: "1.1",
});
// Deliberate weight drop: the muted suffix renders Space Mono Regular at 2xl
// (reads much lighter/rounder than the bold value — that contrast is the look).
const statValueMuted = css({ color: "fg.muted", fontWeight: "normal" });

const section = css({ mb: "8" });
const sectionTitle = css({
  fontFamily: "display",
  fontSize: "lg",
  color: "fg.default",
  mb: "4",
});
const list = css({ display: "flex", flexDirection: "column", gap: "2" });
const empty = css({ color: "fg.muted", fontSize: "sm" });
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
const errorBox = css({ color: "fg.muted", fontSize: "sm", mt: "8" });

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

function StatCard(
  props: { icon: () => JSX.Element; label: string; items: Svc[] },
) {
  const up = () => props.items.filter((s) => s.state === "up").length;
  return (
    <div class={card}>
      <div class={statTop}>
        {props.icon()}
        {props.label}
      </div>
      <div class={statValue}>
        {up()}
        <span class={statValueMuted}>/{props.items.length} up</span>
      </div>
    </div>
  );
}

function DiagnosticsPanel(props: { instance: string }) {
  const diag = createQuery(() => ({
    queryKey: ["diagnose", props.instance],
    queryFn: () => trpc.status.diagnose.query({ instanceName: props.instance }),
    refetchInterval: 5000,
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

function ServiceRow(
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

function Section(
  props: {
    title: string;
    items: Svc[];
    icon: () => JSX.Element;
    expanded: () => string | null;
    setExpanded: (k: string | null) => void;
  },
) {
  return (
    <div class={section}>
      <h2 class={sectionTitle}>{props.title}</h2>
      <div class={list}>
        <Show
          when={props.items.length}
          fallback={<span class={empty}>None.</span>}
        >
          <For each={props.items}>
            {(s) => (
              <ServiceRow
                svc={s}
                icon={props.icon}
                expanded={props.expanded}
                setExpanded={props.setExpanded}
              />
            )}
          </For>
        </Show>
      </div>
    </div>
  );
}

export function StatusPage() {
  const status = createQuery(() => ({
    queryKey: ["status"],
    queryFn: () => trpc.status.get.query(),
    refetchInterval: 5000,
    retry: false,
  }));
  const view = (): View =>
    status.data ?? { minio: [], tailscale: [], host: [] };
  // The instance whose diagnostics accordion is open (one at a time). Held at
  // page scope (not per-row) so the 5s status poll re-rendering the rows can't
  // reset it and snap the accordion shut.
  const [expanded, setExpanded] = createSignal<string | null>(null);

  return (
    <Show
      when={!status.isError}
      fallback={
        <p class={errorBox}>Status unavailable — is the backend reachable?</p>
      }
    >
      <div class={statGrid}>
        <StatCard
          icon={() => <Database size={16} />}
          label="MinIO"
          items={view().minio}
        />
        <StatCard
          icon={() => <Network size={16} />}
          label="Tailscale"
          items={view().tailscale}
        />
        <StatCard
          icon={() => <Server size={16} />}
          label="Host"
          items={view().host}
        />
      </div>

      <Section
        title="MinIO instances"
        items={view().minio}
        icon={() => <Database size={16} />}
        expanded={expanded}
        setExpanded={setExpanded}
      />
      <Section
        title="Tailscale nodes"
        items={view().tailscale}
        icon={() => <Network size={16} />}
        expanded={expanded}
        setExpanded={setExpanded}
      />
      <Section
        title="Host services"
        items={view().host}
        icon={() => <Server size={16} />}
        expanded={expanded}
        setExpanded={setExpanded}
      />
    </Show>
  );
}

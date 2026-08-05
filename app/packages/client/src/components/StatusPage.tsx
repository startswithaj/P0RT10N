import { createQuery } from "@tanstack/solid-query";
import { createSignal, For, type JSX, Show } from "solid-js";
import { css } from "styled-system/css";
import { Database, Network, Server } from "lucide-solid";
import { trpc } from "../trpc.ts";
import { pollMs } from "./helpers.ts";
import type { Svc } from "./status-types.ts";
import { ServiceRow } from "./ServiceRow.tsx";
import { RecentEvents } from "./RecentEvents.tsx";

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
const errorBox = css({ color: "fg.muted", fontSize: "sm", mt: "8" });

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

function Section(
  props: {
    title: string;
    items: Svc[];
    icon: () => JSX.Element;
    expanded: () => string | null;
    setExpanded: (k: string | null) => void;
  },
) {
  // Keyed by name, not object identity: every poll returns fresh objects, so an
  // identity-keyed <For> rebuilds every row and discards any expanded panel.
  const names = () => props.items.map((s) => s.name);
  return (
    <div class={section}>
      <h2 class={sectionTitle}>{props.title}</h2>
      <div class={list}>
        <Show
          when={props.items.length}
          fallback={<span class={empty}>None.</span>}
        >
          <For each={names()}>
            {(name) => (
              <Show when={props.items.find((s) => s.name === name)}>
                {(svc) => (
                  <ServiceRow
                    svc={svc()}
                    icon={props.icon}
                    expanded={props.expanded}
                    setExpanded={props.setExpanded}
                  />
                )}
              </Show>
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
    refetchInterval: pollMs(5000),
    retry: false,
  }));

  const view = (): View =>
    status.data ?? { minio: [], tailscale: [], host: [] };

  // This accordion state is held at page scope, not per-row, so the 5s poll's re-render can't snap it shut.
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
      <RecentEvents />
    </Show>
  );
}

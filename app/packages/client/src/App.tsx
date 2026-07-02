import { createSignal, For, Show } from "solid-js";
import { Portal } from "solid-js/web";
import { createQuery } from "@tanstack/solid-query";
import { css } from "styled-system/css";
import * as Card from "./components/ui/card.tsx";
import * as Menu from "./components/ui/menu.tsx";
import { Badge } from "./components/ui/badge.tsx";
import { Aperture, Wordmark } from "./components/brand.tsx";
import {
  Activity,
  Boxes,
  HardDrive,
  KeyRound,
  Lock,
  MoreVertical,
  PauseCircle,
  Pencil,
  PlayCircle,
  Plus,
  Radio,
  Trash2,
} from "lucide-solid";
import { queryClient, trpc } from "./trpc.ts";
import { setThemeValue, theme } from "./theme.ts";
import type { ProvisionStepKey } from "@p0rt1on/shared/steps";
import { AddPortion, type NewPortion } from "./AddPortion.tsx";
import { StatusPage } from "./StatusPage.tsx";
import { Provisioning } from "./Provisioning.tsx";
import { Bundle } from "./Bundle.tsx";
import {
  ActionDialog,
  type ActionKind,
  type Pending,
} from "./PortionActions.tsx";

declare const __COMMIT__: string; // injected by Vite (short git hash, or "dev")

type FriendRow = Awaited<ReturnType<typeof trpc.friends.list.query>>[number];
type AddBundle = Awaited<ReturnType<typeof trpc.friends.add.mutate>>;

/** Live state of the friends.addStream subscription, driving the provisioning screen. */
type AddState =
  | { kind: "pending"; step: ProvisionStepKey | null }
  | { kind: "done"; bundle: AddBundle }
  | { kind: "error"; message: string; step: ProvisionStepKey | null };

const GB = 1_000_000_000;
const gb = (bytes: number) => `${(bytes / GB).toFixed(1)} GB`;
const pct = (fraction: number) => Math.min(100, Math.round(fraction * 100));
const invalidate = () =>
  queryClient.invalidateQueries({ queryKey: ["friends"] });

// A credentials bundle to show full-screen (rotate hands one back out-of-band of
// the add flow). App renders it over everything when set.
const [shownBundle, setShownBundle] = createSignal<AddBundle | null>(null);

// ---- styles (brand tokens: brandcyan accent, spark magenta, indigo canvas) ----
const page = css({
  minH: "100dvh",
  bg: "bg.canvas",
  color: "fg.default",
  fontFamily: "body",
});
const shell = css({ maxW: "6xl", mx: "auto", px: "8" });
const nav = css({
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  py: "5",
});
const lockup = css({ display: "flex", alignItems: "center", gap: "3" });
// Plain text tabs (website-style nav links). Active state via [data-active] so it
// reliably overrides the base colour (two atomic classes have no cascade winner).
const tabs = css({ display: "flex", gap: "5" });
const tabLink = css({
  fontFamily: "body",
  fontSize: "sm",
  color: "fg.muted",
  bg: "transparent",
  cursor: "pointer",
  _hover: { color: "fg.default" },
  "&[data-active='true']": { color: "fg.default", fontWeight: "bold" },
});
const actions = css({ display: "flex", gap: "6", alignItems: "center" });
// Segmented Dark | Light toggle (matches the website App.tsx header).
const segWrap = css({
  display: "inline-flex",
  borderWidth: "1px",
  borderColor: "border.default",
  rounded: "full",
  p: "0.5",
});
const segBtn = css({
  fontFamily: "body",
  fontSize: "xs",
  letterSpacing: "0.06em",
  px: "3",
  py: "1.5",
  rounded: "full",
  cursor: "pointer",
  bg: "transparent",
  color: "fg.muted",
  _hover: { color: "fg.default" },
  "&[data-active='true']": {
    bg: "brandcyan.9",
    color: "#160F2E",
    _hover: { color: "#160F2E" },
  },
});
const sparkBtn = css({
  display: "inline-flex",
  alignItems: "center",
  gap: "2",
  px: "5",
  h: "10",
  rounded: "full",
  fontFamily: "body",
  fontWeight: "bold",
  fontSize: "sm",
  bg: "spark",
  color: "white",
  borderWidth: "1.5px",
  borderColor: "spark",
  cursor: "pointer",
  transition: "transform 0.12s ease",
  _hover: { transform: "translateY(-1px)" },
});

const cardReset = css({
  boxShadow: "lg",
  borderWidth: "1px",
  borderColor: "border.default",
  bg: "bg.default",
});
const statGrid = css({
  display: "grid",
  gridTemplateColumns: { base: "1fr", sm: "repeat(3, 1fr)" },
  gap: "4",
  mt: "8",
  mb: "12",
});
const statBody = css({
  p: "5",
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
const statSub = css({
  fontSize: "sm",
  color: "fg.muted",
  fontWeight: "normal",
});

const sectionTitle = css({
  fontFamily: "display",
  fontSize: "xl",
  color: "fg.default",
  mb: "5",
});
const cardGrid = css({
  display: "grid",
  gridTemplateColumns: {
    base: "1fr",
    md: "repeat(2, 1fr)",
    xl: "repeat(3, 1fr)",
  },
  gap: "4",
});
const headPad = css({ px: "6", pt: "6", pb: "0" });
const headRow = css({
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: "2",
});
const headRight = css({ display: "flex", gap: "2", alignItems: "center" });
const titleText = css({ fontWeight: "bold", fontSize: "md" });
const bodyStack = css({
  display: "flex",
  flexDirection: "column",
  gap: "3",
  px: "6",
  pt: "4",
  pb: "6",
});
const usageRow = css({
  display: "flex",
  justifyContent: "space-between",
  alignItems: "baseline",
  fontSize: "sm",
});
const barTrack = css({
  h: "2",
  w: "full",
  rounded: "full",
  bg: "bg.muted",
  overflow: "hidden",
});
const barOk = css({ h: "full", bg: "brandcyan.9", rounded: "full" });
const barWarn = css({ h: "full", bg: "spark", rounded: "full" });
const metaRow = css({
  display: "flex",
  justifyContent: "space-between",
  color: "fg.muted",
  fontSize: "sm",
});
const metaItem = css({
  display: "inline-flex",
  alignItems: "center",
  gap: "1.5",
});
const iconBtn = css({
  display: "grid",
  placeItems: "center",
  w: "8",
  h: "8",
  rounded: "l2",
  color: "fg.muted",
  cursor: "pointer",
  _hover: { bg: "bg.muted", color: "fg.default" },
});
const menuItem = css({ display: "flex", alignItems: "center", gap: "2" });
const dangerItem = css({ color: "fg.error" });
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
const statusItem = css({
  display: "inline-flex",
  alignItems: "center",
  gap: "1.5",
});
const dotUp = css({ w: "2", h: "2", rounded: "full", bg: "brandcyan.9" });
const dotDown = css({ w: "2", h: "2", rounded: "full", bg: "fg.error" });

// Outline pills (a cyan fill reads murky on the dark canvas — outline is clean).
const badgeActive = css({ color: "brandcyan.11", borderColor: "brandcyan.8" });
const badgeFailed = css({ color: "fg.error", borderColor: "border.error" });
const badgeNeutral = css({ color: "fg.muted" });

function UsageBar(props: { fraction: number }) {
  return (
    <div class={barTrack}>
      <div
        class={props.fraction >= 0.9 ? barWarn : barOk}
        style={{ width: `${pct(props.fraction)}%` }}
      />
    </div>
  );
}

function statusBadgeClass(status: string) {
  if (status === "active") return badgeActive;
  if (status === "failed") return badgeFailed;
  return badgeNeutral;
}

function StatusBadge(props: { status: string }) {
  return (
    <Badge variant="outline" class={statusBadgeClass(props.status)}>
      {props.status}
    </Badge>
  );
}

// ---- actions ---- the burger menu opens a proper Park UI dialog (below).
const [pendingAction, setPendingAction] = createSignal<Pending | null>(null);

function PortionMenu(props: { friend: FriendRow }) {
  return (
    <Menu.Root
      onSelect={(d) =>
        setPendingAction({
          friend: props.friend,
          kind: d.value as ActionKind,
        })}
    >
      <Menu.Trigger class={iconBtn} aria-label="Actions">
        <MoreVertical size={18} />
      </Menu.Trigger>
      <Portal>
        <Menu.Positioner>
          <Menu.Content>
            <Menu.Item value="resize" class={menuItem}>
              <Pencil size={15} /> Resize quota
            </Menu.Item>
            <Menu.Item value="rotate-s3" class={menuItem}>
              <KeyRound size={15} /> Rotate S3 key
            </Menu.Item>
            <Menu.Item value="rotate-ts" class={menuItem}>
              <Radio size={15} /> Re-issue Tailscale key
            </Menu.Item>
            <Menu.Separator />
            <Show
              when={props.friend.status !== "suspended"}
              fallback={
                <Menu.Item value="resume" class={menuItem}>
                  <PlayCircle size={15} /> Resume
                </Menu.Item>
              }
            >
              <Menu.Item value="suspend" class={menuItem}>
                <PauseCircle size={15} /> Suspend
              </Menu.Item>
            </Show>
            <Menu.Item value="offboard" class={`${menuItem} ${dangerItem}`}>
              <Trash2 size={15} /> Offboard
            </Menu.Item>
          </Menu.Content>
        </Menu.Positioner>
      </Portal>
    </Menu.Root>
  );
}

function StatCard(
  props: { icon: () => unknown; label: string; value: string; sub?: string },
) {
  return (
    <Card.Root class={cardReset}>
      <Card.Body class={statBody}>
        <div class={statTop}>
          {props.icon()}
          {props.label}
        </div>
        <div class={statValue}>
          {props.value}
          <Show when={props.sub}>
            <span class={statSub}>· {props.sub}</span>
          </Show>
        </div>
      </Card.Body>
    </Card.Root>
  );
}

function backendStatus(h: { isError: boolean; isPending: boolean }) {
  if (h.isError) return "Backend down";
  if (h.isPending) return "Connecting…";
  return "Backend up";
}

function NavBar(
  props: {
    view: () => "portions" | "status";
    setView: (v: "portions" | "status") => void;
    onAdd: () => void;
  },
) {
  return (
    <nav class={nav}>
      <div class={lockup}>
        <Aperture size={40} />
        <Wordmark size={32} />
      </div>
      <div class={actions}>
        <div class={tabs}>
          <button
            type="button"
            class={tabLink}
            data-active={props.view() === "portions" ? "true" : "false"}
            onClick={() => props.setView("portions")}
          >
            Portions
          </button>
          <button
            type="button"
            class={tabLink}
            data-active={props.view() === "status" ? "true" : "false"}
            onClick={() => props.setView("status")}
          >
            Status
          </button>
        </div>
        <div class={segWrap}>
          <button
            type="button"
            class={segBtn}
            data-active={theme() === "dark" ? "true" : "false"}
            onClick={() => setThemeValue("dark")}
          >
            Dark
          </button>
          <button
            type="button"
            class={segBtn}
            data-active={theme() === "light" ? "true" : "false"}
            onClick={() => setThemeValue("light")}
          >
            Light
          </button>
        </div>
        <button
          type="button"
          class={sparkBtn}
          onClick={props.onAdd}
        >
          <Plus size={16} /> Add portion
        </button>
      </div>
    </nav>
  );
}

function PortionCard(props: { friend: FriendRow }) {
  return (
    <Card.Root class={cardReset}>
      <Card.Header class={headPad}>
        <div class={headRow}>
          <Card.Title class={titleText}>{props.friend.name}</Card.Title>
          <div class={headRight}>
            <Badge variant="outline">{props.friend.isolationMode}</Badge>
            <StatusBadge status={props.friend.status} />
            <PortionMenu friend={props.friend} />
          </div>
        </div>
      </Card.Header>
      <Card.Body class={bodyStack}>
        <div class={usageRow}>
          <span>
            <strong>{gb(props.friend.usage.bytesUsed)}</strong>{" "}
            <span class={css({ color: "fg.muted" })}>
              / {gb(props.friend.usage.quotaBytes)}
            </span>
          </span>
          <span>{pct(props.friend.usage.fraction)}%</span>
        </div>
        <UsageBar fraction={props.friend.usage.fraction} />
        <div class={metaRow}>
          <span class={metaItem}>
            <Activity size={14} /> {props.friend.requests24h} / 24h
          </span>
          <span class={metaItem}>
            <Lock size={14} /> {props.friend.lockRetentionDays}d
          </span>
        </div>
      </Card.Body>
    </Card.Root>
  );
}

function PortionsView(
  props: {
    rows: () => FriendRow[];
    totalQuota: () => number;
    totalUsed: () => number;
    overallPct: () => number;
  },
) {
  return (
    <>
      <div class={statGrid}>
        <StatCard
          icon={() => <Boxes size={16} />}
          label="Portions"
          value={String(props.rows().length)}
        />
        <StatCard
          icon={() => <HardDrive size={16} />}
          label="Allocated"
          value={gb(props.totalQuota())}
        />
        <StatCard
          icon={() => <Activity size={16} />}
          label="Used"
          value={gb(props.totalUsed())}
          sub={`${props.overallPct()}%`}
        />
      </div>

      <h2 class={sectionTitle}>Portions</h2>
      <div class={cardGrid}>
        <For each={props.rows()}>
          {(f) => <PortionCard friend={f} />}
        </For>
      </div>
    </>
  );
}

function AppFooter(
  props: { health: { isError: boolean; isPending: boolean } },
) {
  return (
    <footer class={footer}>
      <Wordmark size={16} />
      <span class={footerNote}>
        <span class={statusItem}>
          <span class={props.health.isError ? dotDown : dotUp} />
          {backendStatus(props.health)}
        </span>
        · v{__COMMIT__}
      </span>
    </footer>
  );
}

function Dashboard(
  props: {
    view: () => "portions" | "status";
    setView: (v: "portions" | "status") => void;
    onAdd: () => void;
    friends: { isPending: boolean; isError: boolean; error: unknown };
    rows: () => FriendRow[];
    totalQuota: () => number;
    totalUsed: () => number;
    overallPct: () => number;
    health: { isError: boolean; isPending: boolean };
  },
) {
  return (
    <main class={page}>
      <div class={shell}>
        <NavBar
          view={props.view}
          setView={props.setView}
          onAdd={props.onAdd}
        />

        <Show when={!props.friends.isPending} fallback={<p>Loading…</p>}>
          <Show
            when={!props.friends.isError}
            fallback={<p>Failed to load: {String(props.friends.error)}</p>}
          >
            <Show when={props.view() === "status"}>
              <StatusPage />
            </Show>
            <Show when={props.view() === "portions"}>
              <PortionsView
                rows={props.rows}
                totalQuota={props.totalQuota}
                totalUsed={props.totalUsed}
                overallPct={props.overallPct}
              />
            </Show>
          </Show>
        </Show>

        <AppFooter health={props.health} />
      </div>
    </main>
  );
}

// The "Add portion" flow: form → provisioning (runs friends.add) → bundle.
function createAddFlow() {
  const [adding, setAdding] = createSignal(false);
  const [phase, setPhase] = createSignal<"form" | "provisioning" | "bundle">(
    "form",
  );
  const [pending, setPending] = createSignal<NewPortion | null>(null);
  const [addState, setAddState] = createSignal<AddState>({ kind: "pending" });

  const openAdd = () => {
    setPhase("form");
    setAdding(true);
  };
  const finishAdd = () => {
    setAdding(false);
    setPhase("form");
    invalidate();
  };
  // Subscribe to the real provisioning stream; the screen reflects each step as
  // the server reaches it, and freezes on the exact step that fails.
  const startAdd = (input: NewPortion) => {
    setPending(input);
    setAddState({ kind: "pending", step: null });
    setPhase("provisioning");
    trpc.friends.addStream.subscribe({
      name: input.name,
      quotaBytes: input.quotaBytes,
      retentionDays: input.retentionDays,
      isolationMode: input.isolationMode,
    }, {
      onData: (ev) => {
        if (ev.type === "step") setAddState({ kind: "pending", step: ev.step });
        else setAddState({ kind: "done", bundle: ev.result });
      },
      onError: (err) =>
        setAddState((prev) => ({
          kind: "error",
          message: err instanceof Error ? err.message : String(err),
          step: prev.kind === "pending" ? prev.step : null,
        })),
    });
  };
  const doneBundle = () => {
    const s = addState();
    return s.kind === "done" ? s.bundle : null;
  };
  return {
    adding,
    phase,
    setPhase,
    pending,
    addState,
    openAdd,
    finishAdd,
    startAdd,
    doneBundle,
  };
}

// Live backend up/down: poll /health every 5s.
function createHealthQuery() {
  return createQuery(() => ({
    queryKey: ["health"],
    queryFn: async () => {
      const res = await fetch("/health");
      if (!res.ok) throw new Error("down");
      return true;
    },
    refetchInterval: 5000,
    retry: false,
  }));
}

export function App() {
  const {
    adding,
    phase,
    setPhase,
    pending,
    addState,
    openAdd,
    finishAdd,
    startAdd,
    doneBundle,
  } = createAddFlow();
  const [view, setViewRaw] = createSignal<"portions" | "status">("portions");
  // Refetch the friends list whenever we navigate (back) to the Portions tab.
  const setView = (v: "portions" | "status") => {
    if (v === "portions") invalidate();
    setViewRaw(v);
  };

  const friends = createQuery(() => ({
    queryKey: ["friends"],
    queryFn: () => trpc.friends.list.query(),
  }));
  const health = createHealthQuery();

  const rows = () => friends.data ?? [];
  const totalUsed = () => rows().reduce((s, f) => s + f.usage.bytesUsed, 0);
  const totalQuota = () => rows().reduce((s, f) => s + f.usage.quotaBytes, 0);
  const overallPct = () => {
    const q = totalQuota();
    return q > 0 ? pct(totalUsed() / q) : 0;
  };

  return (
    <>
      <ActionDialog
        pending={pendingAction()}
        onClose={() => setPendingAction(null)}
        onBundle={(b) => setShownBundle(b)}
      />
      <Show
        when={shownBundle()}
        fallback={
          <Show
            when={!adding()}
            fallback={
              <Show
                when={phase() === "form"}
                fallback={
                  <Show
                    when={phase() === "provisioning"}
                    fallback={
                      <Show when={doneBundle()}>
                        {(bundle) => (
                          <Bundle
                            bundle={bundle()}
                            enroll={pending()?.enroll ?? "key"}
                            onDone={finishAdd}
                          />
                        )}
                      </Show>
                    }
                  >
                    <Provisioning
                      name={pending()?.name ?? ""}
                      enroll={pending()?.enroll ?? "key"}
                      state={addState}
                      onViewBundle={() => setPhase("bundle")}
                      onDone={finishAdd}
                    />
                  </Show>
                }
              >
                <AddPortion
                  onBack={() => setAdding(false)}
                  onSubmit={startAdd}
                />
              </Show>
            }
          >
            <Dashboard
              view={view}
              setView={setView}
              onAdd={openAdd}
              friends={friends}
              rows={rows}
              totalQuota={totalQuota}
              totalUsed={totalUsed}
              overallPct={overallPct}
              health={health}
            />
          </Show>
        }
      >
        {(b) => (
          <Bundle
            bundle={b()}
            enroll="key"
            onDone={() => {
              setShownBundle(null);
              invalidate();
            }}
          />
        )}
      </Show>
    </>
  );
}

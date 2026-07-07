import { createSignal, For, type JSX, Show } from "solid-js";
import { Portal } from "solid-js/web";
import { createQuery } from "@tanstack/solid-query";
import { css } from "styled-system/css";
import * as Card from "./components/ui/card.tsx";
import * as Menu from "./components/ui/menu.tsx";
import * as Progress from "./components/ui/progress.tsx";
import { Badge } from "./components/ui/badge.tsx";
import { Button } from "./components/ui/button.tsx";
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
  TriangleAlert,
} from "lucide-solid";
import { queryClient, trpc } from "./trpc.ts";
import { setThemeValue, theme } from "./theme.ts";
import type { ProvisionStepKey } from "@p0rt1on/shared/steps";
import type { StatusView } from "@p0rt1on/shared/domain";
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

/** Live state of the add job (observed via jobs.progress), driving the provisioning screen. */
type AddState =
  | { kind: "pending"; step: ProvisionStepKey | null }
  | { kind: "done"; bundle: AddBundle }
  | { kind: "error"; message: string; step: ProvisionStepKey | null };

const GB = 1_000_000_000;
const gb = (bytes: number) => `${(bytes / GB).toFixed(1)} GB`;
const pct = (fraction: number) => Math.min(100, Math.round(fraction * 100));

// Staleness nudge (PLAN wireframe): a friend whose backups quietly stopped is
// the product's core early-warning signal. Nudge after 48h of silence; friends
// who never connected get a neutral note instead of a false alarm.
const STALE_AFTER_MS = 48 * 60 * 60 * 1000;

function relativeTime(ms: number): string {
  const days = Math.floor(ms / 86_400_000);
  if (days > 0) return days === 1 ? "1 day ago" : `${days} days ago`;
  const hours = Math.floor(ms / 3_600_000);
  if (hours > 0) return hours === 1 ? "1 hour ago" : `${hours} hours ago`;
  const minutes = Math.floor(ms / 60_000);
  if (minutes > 0) {
    return minutes === 1 ? "1 minute ago" : `${minutes} minutes ago`;
  }
  return "just now";
}

/** Always renders: recent activity as a muted timestamp, silence past the
 * threshold as the amber nudge, never-connected as a neutral note. */
function staleness(
  lastRequestAt: string | null,
): { label: string; warn: boolean } {
  if (lastRequestAt === null) {
    return { label: "never connected", warn: false };
  }
  const age = Date.now() - new Date(lastRequestAt).getTime();
  if (age < STALE_AFTER_MS) {
    return { label: `last activity ${relativeTime(age)}`, warn: false };
  }
  return { label: `no backups since ${relativeTime(age)}`, warn: true };
}
const invalidate = () =>
  queryClient.invalidateQueries({ queryKey: ["friends"] });

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
// Rendered on Park's Button (variant ghost). The compact pill look is restored by
// overriding the recipe's md height (h:auto) and neutralising the ghost hover
// background (bg:transparent), while active state keeps the cyan fill + onAccent
// ink on hover so the ghost hover-bg never leaks over the active pill.
const segBtn = css({
  fontFamily: "body",
  fontSize: "xs",
  letterSpacing: "0.06em",
  h: "auto",
  px: "3",
  py: "1.5",
  rounded: "full",
  cursor: "pointer",
  bg: "transparent",
  color: "fg.muted",
  _hover: { color: "fg.default", bg: "transparent" },
  "&[data-active='true']": {
    bg: "brandcyan.9",
    color: "onAccent",
    _hover: { color: "onAccent", bg: "brandcyan.9" },
  },
});
// Primary CTA keeps the brand magenta spark (Park's solid is accent-cyan) and the
// nav's rounded-full pill + hover lift; the Button recipe supplies sizing, gap and
// typography. _hover pins bg:spark so the recipe's cyan hover fill can't show.
const sparkBtn = css({
  rounded: "full",
  bg: "spark",
  color: "white",
  transition: "transform 0.12s ease",
  _hover: { bg: "spark", transform: "translateY(-1px)" },
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
// Shown in place of cardGrid when the friends list loads empty.
const emptyState = css({
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  gap: "3",
  py: "16",
  color: "fg.muted",
  borderWidth: "1px",
  borderStyle: "dashed",
  borderColor: "border.default",
  rounded: "l2",
});
const emptyTitle = css({ color: "fg.default", fontWeight: "bold" });
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
const barRoot = css({ w: "full" });
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
const staleWarn = css({
  display: "inline-flex",
  alignItems: "center",
  gap: "1.5",
  fontSize: "xs",
  color: "warning",
});
const staleNeutral = css({
  display: "inline-flex",
  alignItems: "center",
  gap: "1.5",
  fontSize: "xs",
  color: "fg.muted",
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
const dotUp = css({ w: "2", h: "2", rounded: "full", bg: "brandcyan.9" });
const dotDown = css({ w: "2", h: "2", rounded: "full", bg: "fg.error" });
// The footer health chip is a link to the Status page (which shows the issue).
const footerStatusBtn = css({
  h: "auto",
  px: "1",
  gap: "1.5",
  fontSize: "xs",
  letterSpacing: "0.1em",
  textTransform: "uppercase",
  color: "fg.muted",
  bg: "transparent",
  _hover: { color: "fg.default", bg: "transparent" },
});

// Outline pills (a cyan fill reads murky on the dark canvas — outline is clean).
const badgeActive = css({ color: "brandcyan.11", borderColor: "brandcyan.8" });
const badgeFailed = css({ color: "fg.error", borderColor: "border.error" });
const badgeNeutral = css({ color: "fg.muted" });

function UsageBar(props: { fraction: number }) {
  // Park UI Progress (Ark) drives the Range width and sets aria-valuenow from the
  // value, so the old dynamic inline width style is gone. value is the usage % (max
  // defaults to 100); the warn colour still trips at >=90%.
  return (
    <Progress.Root value={pct(props.fraction)} class={barRoot}>
      <Progress.Track class={barTrack}>
        <Progress.Range class={props.fraction >= 0.9 ? barWarn : barOk} />
      </Progress.Track>
    </Progress.Root>
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

function PortionMenu(
  props: { friend: FriendRow; onAction: (p: Pending) => void },
) {
  return (
    <Menu.Root
      onSelect={(d) =>
        props.onAction({
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
  props: {
    icon: () => JSX.Element;
    label: string;
    value: string;
    sub?: string;
  },
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

/**
 * Aggregate system health for the footer, from the same `status.get` snapshot
 * the Status page renders: backend unreachable or any service `down` ⇒
 * unhealthy. `provisioning` is transitional, not unhealthy.
 */
function systemHealth(
  q: { isError: boolean; data?: StatusView },
): "healthy" | "unhealthy" | "checking" {
  if (q.isError) return "unhealthy";
  if (!q.data) return "checking";
  const services = [...q.data.minio, ...q.data.tailscale, ...q.data.host];
  return services.some((s) => s.state === "down") ? "unhealthy" : "healthy";
}

function healthLabel(h: "healthy" | "unhealthy" | "checking"): string {
  if (h === "unhealthy") return "Unhealthy";
  if (h === "checking") return "Checking…";
  return "Healthy";
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
          <Button
            variant="link"
            class={tabLink}
            data-active={props.view() === "portions" ? "true" : "false"}
            onClick={() => props.setView("portions")}
          >
            Portions
          </Button>
          <Button
            variant="link"
            class={tabLink}
            data-active={props.view() === "status" ? "true" : "false"}
            onClick={() => props.setView("status")}
          >
            Status
          </Button>
        </div>
        <div class={segWrap}>
          <Button
            variant="ghost"
            class={segBtn}
            data-active={theme() === "dark" ? "true" : "false"}
            onClick={() => setThemeValue("dark")}
          >
            Dark
          </Button>
          <Button
            variant="ghost"
            class={segBtn}
            data-active={theme() === "light" ? "true" : "false"}
            onClick={() => setThemeValue("light")}
          >
            Light
          </Button>
        </div>
        <Button
          class={sparkBtn}
          onClick={props.onAdd}
        >
          <Plus size={16} /> Add portion
        </Button>
      </div>
    </nav>
  );
}

function PortionCard(
  props: { friend: FriendRow; onAction: (p: Pending) => void },
) {
  const stale = () => staleness(props.friend.lastRequestAt);
  return (
    <Card.Root class={cardReset}>
      <Card.Header class={headPad}>
        <div class={headRow}>
          <Card.Title class={titleText}>{props.friend.name}</Card.Title>
          <div class={headRight}>
            <Badge variant="outline">{props.friend.isolationMode}</Badge>
            <StatusBadge status={props.friend.status} />
            <PortionMenu friend={props.friend} onAction={props.onAction} />
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
        <span class={stale().warn ? staleWarn : staleNeutral}>
          <Show when={stale().warn}>
            <TriangleAlert size={14} />
          </Show>
          {stale().label}
        </span>
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
    onAdd: () => void;
    onAction: (p: Pending) => void;
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
      <Show
        when={props.rows().length > 0}
        fallback={
          <div class={emptyState}>
            <Boxes size={28} />
            <p class={emptyTitle}>No portions yet</p>
            <p>
              Lend a friend a slice of your disk — create your first portion.
            </p>
            <Button size="sm" onClick={() => props.onAdd()}>
              <Plus size={16} /> Add portion
            </Button>
          </div>
        }
      >
        <div class={cardGrid}>
          <For each={props.rows()}>
            {(f) => <PortionCard friend={f} onAction={props.onAction} />}
          </For>
        </div>
      </Show>
    </>
  );
}

function AppFooter(
  props: {
    health: () => "healthy" | "unhealthy" | "checking";
    onStatus: () => void;
  },
) {
  return (
    <footer class={footer}>
      <Wordmark size={16} />
      <span class={footerNote}>
        <Button
          variant="ghost"
          size="xs"
          class={footerStatusBtn}
          onClick={() => props.onStatus()}
        >
          <span class={props.health() === "unhealthy" ? dotDown : dotUp} />
          {healthLabel(props.health())}
        </Button>
        · Version {__COMMIT__}
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
    health: () => "healthy" | "unhealthy" | "checking";
    onAction: (p: Pending) => void;
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
                onAdd={props.onAdd}
                onAction={props.onAction}
              />
            </Show>
          </Show>
        </Show>

        <AppFooter
          health={props.health}
          onStatus={() => props.setView("status")}
        />
      </div>
    </main>
  );
}

// The "Add portion" flow: form → provisioning (friends.addStart job observed
// via jobs.progress, bundle claimed once via jobs.claimBundle) → bundle.
// Exported so the add-flow state machine (esp. the shown-once bundle clearing on
// finishAdd) can be unit-tested without driving the whole App render tree.
export function createAddFlow() {
  const [adding, setAdding] = createSignal(false);
  const [phase, setPhase] = createSignal<"form" | "provisioning" | "bundle">(
    "form",
  );
  const [pending, setPending] = createSignal<NewPortion | null>(null);
  const [addState, setAddState] = createSignal<AddState>({
    kind: "pending",
    step: null,
  });

  const openAdd = () => {
    setPhase("form");
    setAdding(true);
  };
  const finishAdd = () => {
    setAdding(false);
    setPhase("form");
    // Zero-knowledge: the bundle is shown once. Drop the completed add's state so
    // the S3 secret / Tailscale key held in `addState` isn't retained in memory
    // after the hand-off screen closes (until now it lingered until the next add
    // overwrote it). `pending` (name/quota — no secret) is cleared alongside it.
    setAddState({ kind: "pending", step: null });
    setPending(null);
    invalidate();
  };
  const fail = (message: string) =>
    setAddState((prev) => ({
      kind: "error",
      message,
      step: prev.kind === "pending" ? prev.step : null,
    }));
  // Claim the once-shown bundle exactly once (server wipes it on handover).
  // Direct mutate — bundle secrets never enter the TanStack Query cache.
  const claimBundle = (jobId: string) => {
    trpc.jobs.claimBundle.mutate({ jobId })
      .then((bundle) => setAddState({ kind: "done", bundle }))
      .catch((err) => fail(String(err)));
  };
  // Observe the background job: replayed + live step events; failures arrive
  // as `error` DATA events, so a reconnect can never re-run provisioning.
  const observeAdd = (jobId: string) => {
    trpc.jobs.progress.subscribe({ jobId }, {
      onData: (ev) => {
        // Wire steps are plain strings; the keys come from PROVISION_STEPS.
        if (ev.type === "step") {
          setAddState({ kind: "pending", step: ev.step as ProvisionStepKey });
        } else if (ev.type === "error") {
          setAddState({
            kind: "error",
            message: ev.message,
            step: ev.step as ProvisionStepKey | null,
          });
        } else claimBundle(jobId);
      },
      // Transport-level backstop (e.g. server unreachable mid-observe).
      onError: (err) => fail(err instanceof Error ? err.message : String(err)),
    });
  };
  // Start provisioning as a background job, then observe its progress; the
  // screen reflects each step as the server reaches it and freezes on the
  // exact step that fails.
  const startAdd = (input: NewPortion) => {
    setPending(input);
    setAddState({ kind: "pending", step: null });
    setPhase("provisioning");
    trpc.friends.addStart.mutate({
      name: input.name,
      quotaBytes: input.quotaBytes,
      retentionDays: input.retentionDays,
      isolationMode: input.isolationMode,
    })
      .then(({ jobId }) => observeAdd(jobId))
      .catch((err) => fail(err instanceof Error ? err.message : String(err)));
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

/** Aggregate usage figures for the dashboard stat cards. */
function createTotals(rows: () => FriendRow[]) {
  const totalUsed = () => rows().reduce((s, f) => s + f.usage.bytesUsed, 0);
  const totalQuota = () => rows().reduce((s, f) => s + f.usage.quotaBytes, 0);
  const overallPct = () => {
    const q = totalQuota();
    return q > 0 ? pct(totalUsed() / q) : 0;
  };
  return { totalUsed, totalQuota, overallPct };
}

// Footer health: the same query/key the Status page uses (deduped by TanStack
// when both are mounted), so "Unhealthy" always agrees with what that page
// shows. A failed fetch (backend down) also reads as unhealthy.
function createStatusQuery() {
  return createQuery(() => ({
    queryKey: ["status"],
    queryFn: () => trpc.status.get.query(),
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
  // A credentials bundle to show full-screen (rotate hands one back out-of-band
  // of the add flow). App renders it over everything when set.
  const [shownBundle, setShownBundle] = createSignal<AddBundle | null>(null);
  // The burger-menu action awaiting confirmation in the ActionDialog.
  const [pendingAction, setPendingAction] = createSignal<Pending | null>(null);
  // Refetch the friends list whenever we navigate (back) to the Portions tab.
  const setView = (v: "portions" | "status") => {
    if (v === "portions") invalidate();
    setViewRaw(v);
  };

  const friends = createQuery(() => ({
    queryKey: ["friends"],
    queryFn: () => trpc.friends.list.query(),
  }));
  const status = createStatusQuery();

  const rows = () => friends.data ?? [];
  const { totalUsed, totalQuota, overallPct } = createTotals(rows);

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
                  onBack={finishAdd}
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
              health={() => systemHealth(status)}
              onAction={setPendingAction}
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

import { createSignal, Show } from "solid-js";
import { createQuery } from "@tanstack/solid-query";
import { AuthGate, createAuthGate } from "./components/AuthGate.tsx";
import { Dashboard } from "./components/Dashboard.tsx";
import type { FriendRow } from "./components/types.ts";
import { invalidate, pct, pollMs, systemHealth } from "./components/helpers.ts";
import { queryClient, trpc } from "./trpc.ts";
import type { ProvisionStepKey } from "@p0rt1on/shared/steps";
import { AddPortion, type NewPortion } from "./components/AddPortion.tsx";
import { Provisioning } from "./components/Provisioning.tsx";
import { Bundle } from "./components/Bundle.tsx";
import { ActionDialogs } from "./components/ActionDialogs.tsx";
import { InsecureBanner } from "./components/InsecureBanner.tsx";
import { SystemHealthBanner } from "./components/SystemHealthBanner.tsx";
import type { Pending } from "./components/action-dialog-shared.ts";
import { Toaster } from "./components/ui/toast.tsx";

type AddBundle = Awaited<ReturnType<typeof trpc.friends.add.mutate>>;

type AddState =
  | { kind: "pending"; step: ProvisionStepKey | null }
  | { kind: "done"; bundle: AddBundle }
  | { kind: "error"; message: string; step: ProvisionStepKey | null };

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
    // Zero-knowledge: the bundle is shown once, so addState (holding the S3
    // secret and Tailscale key) is cleared here rather than kept in memory.
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

  // The bundle is claimed with a direct mutate call, not a query, so bundle
  // secrets never enter the TanStack Query cache.
  const claimBundle = (jobId: string) => {
    trpc.jobs.claimBundle.mutate({ jobId })
      .then((bundle) => setAddState({ kind: "done", bundle }))
      .catch((err) => fail(String(err)));
  };

  // Failures arrive as error data events rather than exceptions, so a
  // reconnect can never re-run provisioning.
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

  const startAdd = (input: NewPortion) => {
    setPending(input);
    setAddState({ kind: "pending", step: null });
    setPhase("provisioning");
    trpc.friends.addStart.mutate({
      name: input.name,
      quotaBytes: input.quotaBytes,
      retentionDays: input.retentionDays,
      isolationMode: input.isolationMode,
      enrollment: input.enrollment,
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

function createTotals(rows: () => FriendRow[]) {
  const totalUsed = () => rows().reduce((s, f) => s + f.usage.bytesUsed, 0);
  const totalQuota = () => rows().reduce((s, f) => s + f.usage.quotaBytes, 0);

  const overallPct = () => {
    const q = totalQuota();
    return q > 0 ? pct(totalUsed() / q) : 0;
  };

  return { totalUsed, totalQuota, overallPct };
}

// Shares the Status page's exact query key so TanStack dedupes the fetch and
// "Unhealthy" here always agrees with what that page shows.
function createStatusQuery(active: () => boolean) {
  return createQuery(() => ({
    queryKey: ["status"],
    queryFn: () => trpc.status.get.query(),
    refetchInterval: pollMs(5000),
    retry: false,
    enabled: active(),
  }));
}

function createSystemHealthQuery(active: () => boolean) {
  return createQuery(() => ({
    queryKey: ["systemHealth"],
    queryFn: () => trpc.status.health.query(),
    refetchInterval: pollMs(30000),
    retry: false,
    enabled: active(),
  }));
}

function createCapabilitiesQuery(active: () => boolean) {
  return createQuery(() => ({
    queryKey: ["capabilities"],
    queryFn: () => trpc.friends.capabilities.query(),
    enabled: active(),
  }));
}

function createFriendsQuery(active: () => boolean) {
  return createQuery(() => ({
    queryKey: ["friends"],
    queryFn: () => trpc.friends.list.query(),
    enabled: active(),
  }));
}

function createDashboardData(active: () => boolean) {
  const friends = createFriendsQuery(active);
  const capabilities = createCapabilitiesQuery(active);
  const status = createStatusQuery(active);
  const preflight = createSystemHealthQuery(active);
  const rows = () => friends.data ?? [];
  const canProvision = () => preflight.data?.canProvision ?? true;

  const addBlockReason = () =>
    canProvision()
      ? undefined
      : "Resolve the system-health issues above before adding a portion.";

  // Writes the fresh result straight into the query cache, rather than
  // invalidating, so the banner updates immediately.
  const recheckHealth = () =>
    trpc.status.recheckHealth.mutate().then((h) => {
      queryClient.setQueryData(["systemHealth"], h);
    });

  return {
    friends,
    capabilities,
    status,
    preflightData: () => preflight.data,
    rows,
    canProvision,
    addBlockReason,
    recheckHealth,
    ...createTotals(rows),
  };
}

function createViewState() {
  const [view, setView] = createSignal<"portions" | "status">("portions");
  return {
    view,
    setView: (v: "portions" | "status") => {
      if (v === "portions") invalidate();
      setView(v);
    },
  };
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
  const { view, setView } = createViewState();
  // Rotate hands back a credentials bundle out-of-band of the add flow; App
  // renders it full-screen over everything when set.
  const [shownBundle, setShownBundle] = createSignal<AddBundle | null>(null);
  const [pendingAction, setPendingAction] = createSignal<Pending | null>(null);

  const gate = createAuthGate();
  // Dashboard data is only fetched once auth resolves and unlocks, avoiding
  // stray 401s before then.
  const d = createDashboardData(() => gate.ready() && !gate.locked());
  return (
    <AuthGate gate={gate}>
      <InsecureBanner noPassword={gate.noPassword} />
      <SystemHealthBanner report={d.preflightData} onRetry={d.recheckHealth} />
      <Toaster />
      <ActionDialogs
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
                      inviteApiConfigured={d.capabilities.data
                        ?.inviteApiConfigured}
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
                  inviteApiConfigured={d.capabilities.data?.inviteApiConfigured}
                  gated={() => !d.canProvision()}
                  gateReason={d.addBlockReason}
                  takenNames={() => d.rows().map((r) => r.name)}
                />
              </Show>
            }
          >
            <Dashboard
              view={view}
              setView={setView}
              onAdd={openAdd}
              canAdd={d.canProvision}
              addBlockReason={d.addBlockReason}
              friends={d.friends}
              rows={d.rows}
              totalQuota={d.totalQuota}
              totalUsed={d.totalUsed}
              overallPct={d.overallPct}
              health={() => systemHealth(d.status)}
              onAction={setPendingAction}
              onLogout={gate.enabled() ? gate.logout : undefined}
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
    </AuthGate>
  );
}

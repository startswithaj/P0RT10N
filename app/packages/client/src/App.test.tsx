import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { createRoot } from "solid-js";
import { QueryClientProvider } from "@tanstack/solid-query";
import { makeBundle, makeFriend } from "./test-helpers/fixtures.ts";

// queryClient must stay a REAL QueryClient because App's createQuery and the
// provider need it, so only trpc is mocked here, unlike dialog tests that stub queryClient entirely.
vi.mock("./trpc.ts", async () => {
  const { QueryClient } = await import("@tanstack/solid-query");
  return {
    trpc: {
      friends: {
        list: { query: vi.fn() },
        addStart: { mutate: vi.fn() },
        capabilities: { query: vi.fn() },
        inviteStatus: { query: vi.fn() },
      },
      jobs: {
        progress: { subscribe: vi.fn() },
        claimBundle: { mutate: vi.fn() },
      },
      status: {
        get: { query: vi.fn() },
        diagnose: { query: vi.fn() },
      },
      auth: {
        status: { query: vi.fn() },
        login: { mutate: vi.fn() },
        logout: { mutate: vi.fn() },
      },
    },
    queryClient: new QueryClient(),
  };
});

import { queryClient, trpc } from "./trpc.ts";
import { App, createAddFlow } from "./App.tsx";
import type { NewPortion } from "./components/AddPortion.tsx";

describe("App dashboard", () => {
  // deno-lint-ignore no-explicit-any -- the mocked query/subscribe are vi.fns under real tRPC types
  const asMock = (fn: unknown) => fn as any;

  const renderApp = () =>
    render(() => (
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>
    ));

  beforeEach(() => {
    vi.clearAllMocks();
    queryClient.clear();
    asMock(trpc.auth.status.query).mockResolvedValue({
      enabled: false,
      authenticated: true,
    });
    asMock(trpc.status.get.query).mockResolvedValue({
      minio: [],
      tailscale: [],
      host: [{ name: "p0rt1on-api", detail: "control-plane API", state: "up" }],
    });
    asMock(trpc.friends.capabilities.query).mockResolvedValue({
      inviteApiConfigured: true,
    });
    asMock(trpc.friends.inviteStatus.query).mockResolvedValue({
      status: "pending",
      email: "friend@example.com",
    });
  });

  describe("login gate", () => {
    it("shows the login screen, not the dashboard, when auth is on and unauthenticated", async () => {
      asMock(trpc.auth.status.query).mockResolvedValue({
        enabled: true,
        authenticated: false,
      });
      asMock(trpc.friends.list.query).mockResolvedValue([makeFriend({})]);

      renderApp();

      expect(await screen.findByText("Sign in")).toBeInTheDocument();
      // Dashboard chrome must not render behind the gate.
      expect(screen.queryByText("Portions")).not.toBeInTheDocument();
      // Gated data queries never fire while locked.
      expect(trpc.friends.list.query).not.toHaveBeenCalled();
      expect(trpc.status.get.query).not.toHaveBeenCalled();
    });

    it("renders the dashboard once authenticated", async () => {
      asMock(trpc.auth.status.query).mockResolvedValue({
        enabled: true,
        authenticated: true,
      });
      asMock(trpc.friends.list.query).mockResolvedValue([
        makeFriend({ name: "alice" }),
      ]);

      renderApp();

      expect(await screen.findByText("alice")).toBeInTheDocument();
      expect(screen.queryByText("Sign in")).not.toBeInTheDocument();
    });
  });

  describe("friends list", () => {
    it("renders one row per friend with name, status badge and usage Progress", async () => {
      const alice = makeFriend({ name: "alice", status: "active" });
      const bob = makeFriend({ id: 9, name: "bob", status: "suspended" });
      asMock(trpc.friends.list.query).mockResolvedValue([alice, bob]);

      renderApp();

      expect(await screen.findByText("alice")).toBeInTheDocument();
      expect(screen.getByText("bob")).toBeInTheDocument();
      expect(screen.getByText("active")).toBeInTheDocument();
      expect(screen.getByText("suspended")).toBeInTheDocument();
      expect(screen.getAllByRole("progressbar")).toHaveLength(2);
      expect(screen.queryByText("No portions yet")).not.toBeInTheDocument();
    });

    it("renders the empty-state placeholder when the list loads empty", async () => {
      asMock(trpc.friends.list.query).mockResolvedValue([]);

      renderApp();

      expect(await screen.findByText("No portions yet")).toBeInTheDocument();
      // There are two "Add portion" buttons: the NavBar one and the empty-state CTA.
      expect(
        screen.getAllByRole("button", { name: /add portion/i }),
      ).toHaveLength(2);
    });
  });

  describe("staleness nudge", () => {
    const hoursAgo = (h: number) =>
      new Date(Date.now() - h * 3_600_000).toISOString();

    it("nudges past the 48h threshold, stays quiet inside it", async () => {
      const fresh = makeFriend({
        id: 1,
        name: "fresh",
        lastRequestAt: hoursAgo(47),
      });
      const stale = makeFriend({
        id: 2,
        name: "stale",
        lastRequestAt: hoursAgo(72),
      });
      asMock(trpc.friends.list.query).mockResolvedValue([fresh, stale]);

      renderApp();

      expect(await screen.findByText("no backups since 3 days ago"))
        .toBeInTheDocument();
      // Only one nudge is expected: the 47h friend falls inside the threshold
      // and shows a neutral last-activity timestamp instead.
      expect(screen.getAllByText(/no backups since/)).toHaveLength(1);
      expect(screen.getByText("last activity 1 day ago")).toBeInTheDocument();
    });

    it("shows a recent last-activity timestamp for healthy friends", async () => {
      asMock(trpc.friends.list.query).mockResolvedValue([
        makeFriend({ lastRequestAt: hoursAgo(0.05) }),
      ]);

      renderApp();

      expect(await screen.findByText("last activity 3 minutes ago"))
        .toBeInTheDocument();
    });

    it("shows 'never connected' instead of a false nudge for new friends", async () => {
      asMock(trpc.friends.list.query).mockResolvedValue([
        makeFriend({ lastRequestAt: null }),
      ]);

      renderApp();

      expect(await screen.findByText("never connected")).toBeInTheDocument();
      expect(screen.queryByText(/no backups since/)).toBeNull();
    });
  });

  describe("navigation refetch", () => {
    it("refetches the friends list when navigating back to Portions", async () => {
      asMock(trpc.friends.list.query).mockResolvedValue([]);

      renderApp();
      await screen.findByText("No portions yet");
      const callsAfterLoad = asMock(trpc.friends.list.query).mock.calls
        .length as number;

      // Clicking Status then Portions calls setView, which invalidates the cache.
      fireEvent.click(screen.getByRole("button", { name: "Status" }));
      fireEvent.click(screen.getByRole("button", { name: "Portions" }));

      await waitFor(() =>
        expect(asMock(trpc.friends.list.query).mock.calls.length)
          .toBeGreaterThan(callsAfterLoad)
      );
    });
  });

  describe("footer health", () => {
    it("shows Unhealthy when any status-page service is down", async () => {
      asMock(trpc.friends.list.query).mockResolvedValue([]);
      asMock(trpc.status.get.query).mockResolvedValue({
        minio: [{ name: "p0rt1on-x", detail: "dedicated", state: "down" }],
        tailscale: [],
        host: [],
      });

      renderApp();

      expect(await screen.findByText("Unhealthy")).toBeInTheDocument();
    });

    it("shows Healthy and navigates to the Status page on click", async () => {
      asMock(trpc.friends.list.query).mockResolvedValue([]);

      renderApp();

      const chip = await screen.findByRole("button", { name: "Healthy" });
      fireEvent.click(chip);
      // The Status page's MinIO group renders because the chip links to the issue.
      expect(await screen.findByText("MinIO")).toBeInTheDocument();
    });
  });

  describe("usage Progress value", () => {
    it("reflects the bytesUsed/quota percentage on the progressbar", async () => {
      // 50 GB used of 100 GB is 50%. The fraction field mirrors bytesUsed/quotaBytes,
      // so the Progress value is the storage-usage percentage.
      const friend = makeFriend({
        usage: {
          bytesUsed: 50_000_000_000,
          objectCount: 3,
          quotaBytes: 100_000_000_000,
          fraction: 0.5,
          checkedAt: null,
        },
      });
      asMock(trpc.friends.list.query).mockResolvedValue([friend]);

      renderApp();

      const bar = await waitFor(() => screen.getByRole("progressbar"));
      const expectedPct = Math.round(
        (friend.usage.bytesUsed / friend.usage.quotaBytes) * 100,
      );
      expect(bar.getAttribute("aria-valuenow")).toBe(String(expectedPct));
    });
  });

  // The shown-once bundle secret must not linger in component state after the add
  // flow finishes; driving createAddFlow directly proves it, since DOM absence alone wouldn't prove state was reset.
  describe("add flow clears the shown-once bundle", () => {
    const draft: NewPortion = {
      name: "alice",
      quotaBytes: 100_000_000_000,
      retentionDays: 30,
      isolationMode: "dedicated",
      enroll: "key",
    };

    it("drops the bundle and pending draft from state on finishAdd", async () => {
      let dispose!: () => void;
      // Capture the observer handlers so we can push job progress events; the
      // secret-bearing bundle arrives only via the claimBundle mutation.
      let handlers:
        | { onData: (ev: unknown) => void; onError: (err: unknown) => void }
        | undefined;
      asMock(trpc.friends.addStart.mutate).mockResolvedValue({ jobId: "j1" });
      asMock(trpc.jobs.claimBundle.mutate).mockResolvedValue(makeBundle());
      asMock(trpc.jobs.progress.subscribe).mockImplementation(
        (_input: unknown, h: typeof handlers) => {
          handlers = h;
          return { unsubscribe: vi.fn() };
        },
      );

      const flow = createRoot((d) => {
        dispose = d;
        return createAddFlow();
      });
      flow.startAdd(draft);
      // addStart resolves before the progress subscription attaches.
      await waitFor(() => expect(handlers).toBeDefined());
      // The done event carries no secrets; it only triggers the single claim.
      handlers?.onData({ type: "done", bundleReady: true });
      await waitFor(() => expect(flow.doneBundle()).not.toBeNull());
      expect(trpc.jobs.claimBundle.mutate).toHaveBeenCalledWith({
        jobId: "j1",
      });
      expect(flow.pending()).not.toBeNull();

      flow.finishAdd();

      // finishAdd wipes both, so no secret is retained in memory.
      expect(flow.doneBundle()).toBeNull();
      expect(flow.pending()).toBeNull();

      dispose();
    });
  });
});

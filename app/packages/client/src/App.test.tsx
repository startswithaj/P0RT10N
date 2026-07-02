import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@solidjs/testing-library";
import { createRoot } from "solid-js";
import { QueryClientProvider } from "@tanstack/solid-query";
import { makeBundle, makeFriend } from "./test-helpers/fixtures.ts";

// Mock trpc/query so the friends list resolves from a fixture and the add-stream
// subscription is an observable spy. `queryClient` must stay a REAL QueryClient
// (App's createQuery + the provider need it), so only `trpc` is faked — unlike
// the dialog tests, which can stub queryClient entirely.
vi.mock("./trpc.ts", async () => {
  const { QueryClient } = await import("@tanstack/solid-query");
  return {
    trpc: {
      friends: {
        list: { query: vi.fn() },
        addStream: { subscribe: vi.fn() },
      },
    },
    queryClient: new QueryClient(),
  };
});

import { queryClient, trpc } from "./trpc.ts";
import { App, createAddFlow } from "./App.tsx";
import type { NewPortion } from "./AddPortion.tsx";

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
  });

  describe("friends list", () => {
    it("renders one row per friend with name, status badge and usage Progress", async () => {
      const alice = makeFriend({ name: "alice", status: "active" });
      const bob = makeFriend({ id: 9, name: "bob", status: "suspended" });
      asMock(trpc.friends.list.query).mockResolvedValue([alice, bob]);

      renderApp();

      // One card per friend: both names, both status badges, and one Progress
      // bar (role=progressbar) per row.
      expect(await screen.findByText("alice")).toBeInTheDocument();
      expect(screen.getByText("bob")).toBeInTheDocument();
      expect(screen.getByText("active")).toBeInTheDocument();
      expect(screen.getByText("suspended")).toBeInTheDocument();
      expect(screen.getAllByRole("progressbar")).toHaveLength(2);
    });
  });

  describe("usage Progress value", () => {
    it("reflects the bytesUsed/quota percentage on the progressbar", async () => {
      // 50 GB used of 100 GB → 50%. fraction mirrors bytesUsed/quotaBytes so the
      // Progress value is the storage-usage percentage.
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

  // AC#3: after the add flow finishes, the shown-once bundle secret must not
  // linger in component state. Driving the state machine directly (createAddFlow)
  // asserts the clearing precisely — the DOM masks the secret, so DOM absence
  // alone wouldn't prove state was reset.
  describe("add flow clears the shown-once bundle", () => {
    const draft: NewPortion = {
      name: "alice",
      quotaBytes: 100_000_000_000,
      retentionDays: 30,
      isolationMode: "dedicated",
      enroll: "key",
    };

    it("drops the bundle and pending draft from state on finishAdd", () => {
      createRoot((dispose) => {
        // Capture the subscription handlers so we can push a "done" event with a
        // secret-bearing bundle, mirroring the real provisioning stream.
        let handlers:
          | { onData: (ev: unknown) => void; onError: (err: unknown) => void }
          | undefined;
        asMock(trpc.friends.addStream.subscribe).mockImplementation(
          (_input: unknown, h: typeof handlers) => {
            handlers = h;
            return { unsubscribe: vi.fn() };
          },
        );

        const flow = createAddFlow();
        flow.startAdd(draft);
        handlers?.onData({ type: "done", result: makeBundle() });

        // The completed add exposes the bundle (and remembers the draft)...
        expect(flow.doneBundle()).not.toBeNull();
        expect(flow.pending()).not.toBeNull();

        flow.finishAdd();

        // ...but finishAdd wipes both, so no secret is retained in memory.
        expect(flow.doneBundle()).toBeNull();
        expect(flow.pending()).toBeNull();

        dispose();
      });
    });
  });
});

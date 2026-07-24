import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@solidjs/testing-library";
import { QueryClientProvider } from "@tanstack/solid-query";
import { makeService, makeStatusView } from "../test-helpers/fixtures.ts";

// Mock `trpc` only; `queryClient` stays a real QueryClient (createQuery + provider need it).
vi.mock("../trpc.ts", async () => {
  const { QueryClient } = await import("@tanstack/solid-query");
  return {
    trpc: {
      status: {
        get: { query: vi.fn() },
        diagnose: { query: vi.fn() },
      },
      audit: {
        list: { query: vi.fn() },
      },
    },
    queryClient: new QueryClient(),
  };
});

import { queryClient, trpc } from "../trpc.ts";
import { StatusPage } from "./StatusPage.tsx";

describe("StatusPage", () => {
  // deno-lint-ignore no-explicit-any -- the mocked query is a vi.fn under real tRPC types
  const asMock = (fn: unknown) => fn as any;

  const renderPage = () =>
    render(() => (
      <QueryClientProvider client={queryClient}>
        <StatusPage />
      </QueryClientProvider>
    ));

  beforeEach(() => {
    vi.clearAllMocks();
    queryClient.clear();
    // Recent-events panel: default to empty; individual tests override.
    asMock(trpc.audit.list.query).mockResolvedValue([]);
  });

  describe("instance health states", () => {
    it("renders healthy (up), unhealthy (down) and provisioning states from a fixture", async () => {
      // One MinIO group carrying all three states; the other groups are empty so
      // each state label appears exactly once across the page.
      asMock(trpc.status.get.query).mockResolvedValue(
        makeStatusView({
          minio: [
            makeService({ name: "alice-minio", state: "up" }),
            makeService({ name: "bob-minio", state: "provisioning" }),
            makeService({ name: "carol-minio", state: "down" }),
            makeService({ name: "dave-minio", state: "lost" }),
          ],
          tailscale: [],
          host: [],
        }),
      );

      renderPage();

      expect(await screen.findByText("Up")).toBeInTheDocument();
      expect(screen.getByText("Provisioning")).toBeInTheDocument();
      expect(screen.getByText("Down")).toBeInTheDocument();
      // Data loss reads distinctly from a recoverable "Down".
      expect(screen.getByText("Data lost")).toBeInTheDocument();
    });
  });

  describe("recent events", () => {
    it("renders the audit trail: humanized actions, friend or system", async () => {
      asMock(trpc.status.get.query).mockResolvedValue(
        makeStatusView({ minio: [], tailscale: [], host: [] }),
      );
      asMock(trpc.audit.list.query).mockResolvedValue([
        {
          id: 3,
          when: "2026-07-22 10:00:00",
          action: "instance_data_lost",
          friend: null,
          detail: "p0rt1on-alice — 1 portion(s), backups unrecoverable",
        },
        {
          id: 2,
          when: "2026-07-22 09:00:00",
          action: "offboard",
          friend: "carol",
          detail: null,
        },
      ]);

      renderPage();

      // Await the async audit content before the synchronous assertions.
      expect(await screen.findByText("Data lost")).toBeInTheDocument();
      expect(screen.getByText("Recent events")).toBeInTheDocument();
      expect(screen.getByText("Offboarded")).toBeInTheDocument(); // humanized
      expect(screen.getByText("carol")).toBeInTheDocument();
      expect(screen.getByText("system")).toBeInTheDocument(); // null friend
    });

    it("shows an empty note when the log has no entries", async () => {
      asMock(trpc.status.get.query).mockResolvedValue(
        makeStatusView({ minio: [], tailscale: [], host: [] }),
      );
      // audit.list defaults to [] in beforeEach.
      renderPage();
      expect(await screen.findByText("No events yet.")).toBeInTheDocument();
    });
  });

  describe("warning styling near quota / provisioning", () => {
    it("routes provisioning warning styling through the warning token, not a hex literal", async () => {
      asMock(trpc.status.get.query).mockResolvedValue(
        makeStatusView({
          minio: [makeService({ name: "alice-minio", state: "provisioning" })],
          tailscale: [],
          host: [],
        }),
      );

      const { container } = renderPage();

      // Provisioning pill uses token classes (`c_warning` text, `bg_warning` dot); assert raw amber hex never leaks into markup.
      const pill = await screen.findByText("Provisioning");
      expect(pill.className).toContain("c_warning");

      const dot = pill.querySelector("span");
      expect(dot?.className).toContain("bg_warning");

      expect(container.innerHTML.toLowerCase()).not.toContain("#e0a83e");
    });
  });
});

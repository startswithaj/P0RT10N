import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@solidjs/testing-library";
import { QueryClientProvider } from "@tanstack/solid-query";
import { makeService, makeStatusView } from "../test-helpers/fixtures.ts";

// Mock trpc/query so `status.get` resolves from a fixture. `queryClient` must
// stay a REAL QueryClient (StatusPage's createQuery + the provider need it), so
// only `trpc` is faked — mirroring App.test.tsx, not the dialog tests.
vi.mock("../trpc.ts", async () => {
  const { QueryClient } = await import("@tanstack/solid-query");
  return {
    trpc: {
      status: {
        get: { query: vi.fn() },
        diagnose: { query: vi.fn() },
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

      // The provisioning status pill's text colour comes from `css({color:
      // "warning"})` → the token-derived class `c_warning`, and its dot from
      // `css({bg: "warning"})` → `bg_warning`. Assert the token classes are used
      // and the raw amber hex (#E0A83E) never leaks into the rendered markup.
      const pill = await screen.findByText("Provisioning");
      expect(pill.className).toContain("c_warning");

      const dot = pill.querySelector("span");
      expect(dot?.className).toContain("bg_warning");

      expect(container.innerHTML.toLowerCase()).not.toContain("#e0a83e");
    });
  });
});

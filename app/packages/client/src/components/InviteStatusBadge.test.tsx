import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@solidjs/testing-library";
import { QueryClientProvider } from "@tanstack/solid-query";
import { makeFriend } from "../test-helpers/fixtures.ts";

// Uses a real QueryClient so createQuery works; only the trpc call is a spy.
vi.mock("../trpc.ts", async () => {
  const { QueryClient } = await import("@tanstack/solid-query");
  return {
    trpc: { friends: { inviteStatus: { query: vi.fn() } } },
    queryClient: new QueryClient(),
  };
});

import { queryClient, trpc } from "../trpc.ts";
import { InviteStatusBadge } from "./InviteStatusBadge.tsx";

describe("InviteStatusBadge", () => {
  // Helpers stay inside the describe block to satisfy the no-test-globals lint rule.
  // deno-lint-ignore no-explicit-any -- The mocked query is a vi.fn under a real tRPC type.
  const asMock = (fn: unknown) => fn as any;

  const renderBadge = (friend: ReturnType<typeof makeFriend>) =>
    render(() => (
      <QueryClientProvider client={queryClient}>
        <InviteStatusBadge friend={friend} />
      </QueryClientProvider>
    ));

  beforeEach(() => {
    vi.clearAllMocks();
    queryClient.clear();
  });

  it("renders nothing for an auth-key friend", () => {
    const { container } = renderBadge(
      makeFriend({ enrollmentMode: "authKey", inviteStatus: null }),
    );
    expect(container.textContent).toBe("");
    expect(trpc.friends.inviteStatus.query).not.toHaveBeenCalled();
  });

  it("shows a terminal status from the list without re-querying", async () => {
    renderBadge(
      makeFriend({ enrollmentMode: "invite", inviteStatus: "accepted" }),
    );
    expect(await screen.findByText("Invite accepted")).toBeInTheDocument();
    // Accepted is a terminal status, so no reconcile call happens.
    expect(trpc.friends.inviteStatus.query).not.toHaveBeenCalled();
  });

  it("reconciles a pending invite and shows the fresh status", async () => {
    asMock(trpc.friends.inviteStatus.query).mockResolvedValue({
      status: "accepted",
      email: "bob@example.com",
    });
    renderBadge(
      makeFriend({ id: 5, enrollmentMode: "invite", inviteStatus: "pending" }),
    );

    await waitFor(() =>
      expect(screen.getByText("Invite accepted")).toBeInTheDocument()
    );
    expect(trpc.friends.inviteStatus.query).toHaveBeenCalledWith({
      friendId: 5,
    });
  });

  it("reconciles a MANUAL invite too (OAuth acceptance check, no token)", async () => {
    asMock(trpc.friends.inviteStatus.query).mockResolvedValue({
      status: "accepted",
      email: "bob@example.com",
    });
    renderBadge(
      makeFriend({ id: 8, enrollmentMode: "invite", inviteStatus: "manual" }),
    );

    await waitFor(() =>
      expect(screen.getByText("Invite accepted")).toBeInTheDocument()
    );
    expect(trpc.friends.inviteStatus.query).toHaveBeenCalledWith({
      friendId: 8,
    });
  });
});

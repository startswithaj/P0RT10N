import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@solidjs/testing-library";
import { makeFriend } from "../test-helpers/fixtures.ts";
import { PortionMenu } from "./PortionMenu.tsx";

// The burger menu's enrollment-aware items: auth-key friends can re-issue their
// tag key; invite friends can't (no tagged node) but can resend a pending invite.
describe("PortionMenu", () => {
  const open = (friend: ReturnType<typeof makeFriend>) => {
    render(() => <PortionMenu friend={friend} onAction={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Actions" }));
  };

  it("auth-key friend: shows Re-issue Tailscale key, no Resend invite", async () => {
    open(makeFriend({ enrollmentMode: "authKey", inviteStatus: null }));
    expect(await screen.findByText("Re-issue Tailscale key"))
      .toBeInTheDocument();
    expect(screen.queryByText("Resend invite")).toBeNull();
  });

  it("pending invite: hides Re-issue Tailscale key, shows Resend invite", async () => {
    open(makeFriend({ enrollmentMode: "invite", inviteStatus: "pending" }));
    expect(await screen.findByText("Resend invite")).toBeInTheDocument();
    expect(screen.queryByText("Re-issue Tailscale key")).toBeNull();
  });

  it("accepted invite: hides both Re-issue and Resend", async () => {
    open(makeFriend({ enrollmentMode: "invite", inviteStatus: "accepted" }));
    // The menu still renders (Rotate S3 key is common to both modes).
    expect(await screen.findByText("Rotate S3 key")).toBeInTheDocument();
    expect(screen.queryByText("Re-issue Tailscale key")).toBeNull();
    expect(screen.queryByText("Resend invite")).toBeNull();
  });
});

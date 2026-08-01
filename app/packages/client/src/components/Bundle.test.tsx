import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { Bundle } from "./Bundle.tsx";
import { toaster } from "./ui/toast.tsx";
import { makeBundle } from "../test-helpers/fixtures.ts";

// This suite covers the shown-once bundle hand-off: the S3 secret must stay masked
// until revealed, and the Tailscale section shows the up-command only for key enroll, an invite note otherwise.
describe("Bundle", () => {
  // Per-test helpers stay INSIDE describe (the no-test-globals lint plugin
  // forbids module-level const/function in *.test.* files).
  const renderBundle = (
    overrides: Parameters<typeof makeBundle>[0] = {},
    enroll: "key" | "invite" = "key",
  ) => {
    const bundle = makeBundle(overrides);
    render(() => <Bundle bundle={bundle} enroll={enroll} onDone={vi.fn()} />);
    return bundle;
  };

  describe("secret masking", () => {
    it("masks the S3 secret by default and reveals it on toggle", async () => {
      const bundle = renderBundle();

      // Access key is always visible; the secret is dotted out until revealed.
      expect(screen.getByText(bundle.s3AccessKeyId)).toBeInTheDocument();
      expect(screen.queryByText(bundle.s3SecretKey)).toBeNull();

      fireEvent.click(screen.getByRole("button", { name: "Reveal" }));

      expect(await screen.findByText(bundle.s3SecretKey)).toBeInTheDocument();
    });
  });

  describe("server warnings", () => {
    it("renders each warning from the bundle", () => {
      renderBundle({
        warnings: ["The old credential could not be removed and stays live."],
      });

      expect(
        screen.getByText(/old credential could not be removed/i),
      ).toBeInTheDocument();
    });

    it("renders no warning block when the bundle has none", () => {
      renderBundle();
      expect(screen.queryByText(/could not be removed/i)).toBeNull();
    });
  });

  describe("copy all", () => {
    it("copies every section on the screen, not just the S3 fields", () => {
      const writeText = vi.fn(() => Promise.resolve());
      vi.stubGlobal("navigator", { clipboard: { writeText } });
      const bundle = renderBundle({
        manualAclInstructions: '{"src": ["tag:friend"]}',
      }, "key");

      fireEvent.click(screen.getByRole("button", { name: /copy all/i }));

      expect(writeText).toHaveBeenCalledTimes(1);
      const text = writeText.mock.calls[0][0] as unknown as string;
      expect(text).toContain(bundle.s3AccessKeyId);
      expect(text).toContain(bundle.s3SecretKey);
      expect(text).toContain(bundle.s3Endpoint);
      expect(text).toContain(bundle.bucket);
      expect(text).toContain(bundle.tailscaleUpCommand as string);
      expect(text).toContain(bundle.manualAclInstructions as string);
      expect(text).toContain(bundle.kopiaQuickstart);
      vi.unstubAllGlobals();
    });

    // A denied clipboard permission must not fail silently. The "Copied" indicator only
    // appears on success, so without the toast the button would look dead.
    it("toasts when the clipboard write is rejected", async () => {
      const writeText = vi.fn(() => Promise.reject(new Error("denied")));
      vi.stubGlobal("navigator", { clipboard: { writeText } });
      const create = vi.spyOn(toaster, "create");
      renderBundle();

      fireEvent.click(screen.getByRole("button", { name: /copy all/i }));

      await waitFor(() =>
        expect(create).toHaveBeenCalledWith(
          expect.objectContaining({ type: "error", description: "denied" }),
        )
      );
      vi.unstubAllGlobals();
    });
  });

  describe("tailscale section", () => {
    it("renders the up-command when an auth key is present (key enroll)", () => {
      const bundle = renderBundle({}, "key");

      expect(screen.getByText("Tailscale")).toBeInTheDocument();
      expect(
        screen.getByText(bundle.tailscaleUpCommand as string),
      ).toBeInTheDocument();
    });

    it("invite: shows 'emailed to X' + the link, hides the up-command", () => {
      renderBundle({
        tailscaleUpCommand: undefined,
        enrollmentMode: "invite",
        inviteEmail: "bob@example.com",
        inviteEmailedAt: "2026-07-01T00:00:00Z",
        inviteUrl: "https://login.tailscale.com/uinv/inv1",
      }, "invite");

      expect(screen.getByText(/emailed to bob@example.com/i))
        .toBeInTheDocument();
      expect(screen.getByText("https://login.tailscale.com/uinv/inv1"))
        .toBeInTheDocument();
      expect(screen.queryByText(/tailscale up --authkey/i)).toBeNull();
    });

    it("invite without an emailed time reads 'created — share the link'", () => {
      renderBundle({
        tailscaleUpCommand: undefined,
        enrollmentMode: "invite",
        inviteEmail: "bob@example.com",
        inviteUrl: "https://login.tailscale.com/uinv/inv1",
      }, "invite");

      expect(screen.getByText(/share the link below/i)).toBeInTheDocument();
    });

    it("invite with no token surfaces the manual-invite console steps", () => {
      renderBundle({
        tailscaleUpCommand: undefined,
        enrollmentMode: "invite",
        inviteEmail: "bob@example.com",
        manualInviteInstructions: "1. Open the Tailscale users console",
      }, "invite");

      expect(screen.getByText(/invite manually/i)).toBeInTheDocument();
      expect(screen.getByText(/Open the Tailscale users console/i))
        .toBeInTheDocument();
      // The header must not claim an invite was created, since none was sent.
      expect(screen.getByText(/No invite was sent automatically/i))
        .toBeInTheDocument();
      expect(screen.queryByText(/Invite created/i)).toBeNull();
    });
  });
});

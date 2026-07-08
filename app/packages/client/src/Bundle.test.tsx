import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@solidjs/testing-library";
import { Bundle } from "./Bundle.tsx";
import { makeBundle } from "./test-helpers/fixtures.ts";

// Covers the shown-once bundle hand-off: the S3 secret must stay masked until
// the user reveals it, and the Tailscale section must render the up-command
// only when an auth key is present (key enroll), swapping to the invite note
// otherwise.
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

      // The reveal signal flips the Show; the raw secret is now on screen.
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
      // S3 credentials…
      expect(text).toContain(bundle.s3AccessKeyId);
      expect(text).toContain(bundle.s3SecretKey);
      expect(text).toContain(bundle.s3Endpoint);
      expect(text).toContain(bundle.bucket);
      // …plus the Tailscale command, ACL lines, and Kopia quickstart.
      expect(text).toContain(bundle.tailscaleUpCommand as string);
      expect(text).toContain(bundle.manualAclInstructions as string);
      expect(text).toContain(bundle.kopiaQuickstart);
      vi.unstubAllGlobals();
    });
  });

  describe("tailscale section", () => {
    it("renders the up-command when an auth key is present (key enroll)", () => {
      const bundle = renderBundle({}, "key");

      // The tailscale eyebrow + the up-command code block both render.
      expect(screen.getByText("Tailscale")).toBeInTheDocument();
      expect(
        screen.getByText(bundle.tailscaleUpCommand as string),
      ).toBeInTheDocument();
    });

    it("shows the invite note instead when there is no auth key", () => {
      // Invite enroll: no tailscaleUpCommand, so the command block is absent and
      // the emailed-invite note takes its place.
      renderBundle({ tailscaleUpCommand: undefined }, "invite");

      expect(screen.getByText(/An invite has been emailed/i))
        .toBeInTheDocument();
      expect(screen.queryByText(/tailscale up --authkey/i)).toBeNull();
    });
  });
});

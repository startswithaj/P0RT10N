import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@solidjs/testing-library";
import { PROVISION_STEPS } from "@p0rt1on/shared/steps";
import { Provisioning, type ProvisionState } from "./Provisioning.tsx";

// Covers the provisioning checklist: it renders one row per streamed step and,
// on failure, marks the exact failing step errored (rather than spinning past
// it). Icons are asserted via lucide's class names — circle-check = done,
// loader-circle = active, circle-x = failed.
describe("Provisioning", () => {
  // Per-test helpers stay INSIDE describe (the no-test-globals lint plugin
  // forbids module-level const/function in *.test.* files).
  const renderAt = (state: ProvisionState) => {
    render(() => (
      <Provisioning
        name="alice"
        enroll="key"
        state={() => state}
        onDone={vi.fn()}
        onViewBundle={vi.fn()}
      />
    ));
  };

  // The row div wrapping a given step's label (label span → nearest div).
  const rowFor = (label: string) =>
    screen.getByText(label).closest("div") as HTMLElement;

  it("renders a checklist row per provision step", () => {
    // Live on the 4th step (bucket): earlier steps done, this one active.
    renderAt({ kind: "pending", step: "bucket" });

    // One row per step key, in order, all labels present.
    PROVISION_STEPS.forEach((s) => {
      expect(screen.getByText(s.label)).toBeInTheDocument();
    });

    // The three earlier steps show the done check; the live step spins.
    expect(document.querySelectorAll(".lucide-circle-check")).toHaveLength(3);
    expect(document.querySelectorAll(".lucide-loader-circle")).toHaveLength(1);
    expect(
      rowFor("Creating bucket & S3 user").querySelector(
        ".lucide-loader-circle",
      ),
    ).not.toBeNull();
  });

  it("marks the failing step errored and shows the failure message", () => {
    renderAt({
      kind: "error",
      step: "bucket",
      message: "bucket already exists",
    });

    // The failing step carries the error icon; nothing spins past it.
    expect(
      rowFor("Creating bucket & S3 user").querySelector(
        ".lucide-circle-x",
      ),
    ).not.toBeNull();
    expect(document.querySelectorAll(".lucide-loader-circle")).toHaveLength(0);

    // Steps before the failure are still marked done; the reported error
    // message surfaces in the failure block.
    expect(
      rowFor("Starting MinIO instance").querySelector(
        ".lucide-circle-check",
      ),
    ).not.toBeNull();
    expect(screen.getByText("bucket already exists")).toBeInTheDocument();
  });
});

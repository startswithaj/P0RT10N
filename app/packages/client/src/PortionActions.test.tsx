import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { makeFriend } from "./test-helpers/fixtures.ts";

// Mock the trpc/query module so the dialog's mutations and cache invalidation
// are observable spies instead of real network calls. The dialog imports both
// `trpc` and `queryClient` from ./trpc.ts.
vi.mock("./trpc.ts", () => ({
  trpc: {
    friends: {
      rotateKey: { mutate: vi.fn() },
      reissueTsKey: { mutate: vi.fn() },
      suspend: { mutate: vi.fn() },
      resume: { mutate: vi.fn() },
      resize: { mutate: vi.fn() },
      offboardStart: { mutate: vi.fn() },
    },
    jobs: {
      progress: { subscribe: vi.fn() },
      claimBundle: { mutate: vi.fn() },
    },
  },
  queryClient: { invalidateQueries: vi.fn() },
}));

import { trpc } from "./trpc.ts";
import { ActionDialog, type Pending } from "./PortionActions.tsx";

describe("ActionDialog", () => {
  // deno-lint-ignore no-explicit-any -- the mocked mutate is a vi.fn under a real tRPC type
  const mutateOf = (fn: unknown) => fn as any;

  const renderDialog = (pending: Pending) => {
    const onClose = vi.fn();
    const onBundle = vi.fn();
    render(() => (
      <ActionDialog pending={pending} onClose={onClose} onBundle={onBundle} />
    ));
    return { onClose, onBundle };
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mutateOf(trpc.friends.rotateKey.mutate).mockResolvedValue({
      s3AccessKeyId: "AKIA",
      s3SecretAccessKey: "secret",
    });
    mutateOf(trpc.friends.suspend.mutate).mockResolvedValue(undefined);
  });

  describe("offboard confirm gating", () => {
    it("enables Offboard exactly when the typed text equals the name the label shows", () => {
      const friend = makeFriend({ name: "alice" });
      renderDialog({ friend, kind: "offboard" });

      const button = screen.getByRole("button", { name: "Offboard" });
      // Empty field: disabled.
      expect(button).toBeDisabled();

      // Typing the name verbatim (as the label instructs) enables it.
      const input = screen.getByRole("textbox");
      fireEvent.input(input, { target: { value: friend.name } });
      expect(button).toBeEnabled();
    });

    it("keeps Offboard disabled when the confirm text does not match", () => {
      const friend = makeFriend({ name: "alice" });
      renderDialog({ friend, kind: "offboard" });

      const button = screen.getByRole("button", { name: "Offboard" });
      const input = screen.getByRole("textbox");

      // A near-miss (upper-cased) must NOT satisfy the verbatim-name rule.
      fireEvent.input(input, { target: { value: "ALICE" } });
      expect(button).toBeDisabled();

      fireEvent.input(input, { target: { value: "alic" } });
      expect(button).toBeDisabled();
    });
  });

  describe("Enter confirms", () => {
    it("Enter in the resize field confirms (same as clicking Save)", async () => {
      mutateOf(trpc.friends.resize.mutate).mockResolvedValue(undefined);
      const friend = makeFriend({ id: 3 });
      const { onClose } = renderDialog({ friend, kind: "resize" });

      const input = screen.getByRole("spinbutton");
      fireEvent.input(input, { target: { value: "5" } });
      fireEvent.keyDown(input, { key: "Enter" });

      await waitFor(() =>
        expect(trpc.friends.resize.mutate).toHaveBeenCalledWith({
          friendId: 3,
          quotaBytes: 5_000_000_000,
        })
      );
      await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    });

    it("Enter does nothing while the offboard name doesn't match", () => {
      const friend = makeFriend({ name: "alice" });
      renderDialog({ friend, kind: "offboard" });

      const input = screen.getByRole("textbox");
      fireEvent.input(input, { target: { value: "alic" } });
      fireEvent.keyDown(input, { key: "Enter" });
      expect(trpc.friends.offboardStart.mutate).not.toHaveBeenCalled();

      // Matching name: Enter now triggers the offboard.
      mutateOf(trpc.friends.offboardStart.mutate).mockResolvedValue({
        jobId: "j1",
      });
      mutateOf(trpc.jobs.progress.subscribe).mockReturnValue(undefined);
      fireEvent.input(input, { target: { value: "alice" } });
      fireEvent.keyDown(input, { key: "Enter" });
      expect(trpc.friends.offboardStart.mutate).toHaveBeenCalledWith({
        friendId: friend.id,
      });
    });

    it("Enter on a focused button keeps its native meaning (no hijack)", () => {
      const friend = makeFriend({ name: "alice" });
      renderDialog({ friend, kind: "suspend" });

      const cancel = screen.getByRole("button", { name: "Cancel" });
      fireEvent.keyDown(cancel, { key: "Enter" });
      expect(trpc.friends.suspend.mutate).not.toHaveBeenCalled();
    });
  });

  describe("rotate/suspend handlers", () => {
    it("rotate calls rotateKey.mutate and closes on confirm", async () => {
      const friend = makeFriend({ id: 42 });
      const { onClose, onBundle } = renderDialog({ friend, kind: "rotate-s3" });

      fireEvent.click(screen.getByRole("button", { name: "Rotate key" }));

      await waitFor(() =>
        expect(trpc.friends.rotateKey.mutate).toHaveBeenCalledWith({
          friendId: 42,
        })
      );
      await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
      expect(onBundle).toHaveBeenCalledTimes(1);
      expect(trpc.friends.suspend.mutate).not.toHaveBeenCalled();
    });

    it("suspend calls suspend.mutate and closes on confirm", async () => {
      const friend = makeFriend({ id: 9 });
      const { onClose } = renderDialog({ friend, kind: "suspend" });

      fireEvent.click(screen.getByRole("button", { name: "Suspend" }));

      await waitFor(() =>
        expect(trpc.friends.suspend.mutate).toHaveBeenCalledWith({
          friendId: 9,
        })
      );
      await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    });

    it("rotate dialog warns the new secret is shown once, before confirming", () => {
      const friend = makeFriend();
      renderDialog({ friend, kind: "rotate-s3" });

      // The warning is part of the pre-confirmation copy (w1 US-006).
      expect(screen.getByText(/shown once/i)).toBeInTheDocument();
      expect(trpc.friends.rotateKey.mutate).not.toHaveBeenCalled();
    });

    it("offboard starts a job and surfaces a job error event on the checklist", async () => {
      const friend = makeFriend({ id: 7, name: "alice" });
      renderDialog({ friend, kind: "offboard" });
      mutateOf(trpc.friends.offboardStart.mutate).mockResolvedValue({
        jobId: "j1",
      });
      let handlers:
        | { onData: (ev: unknown) => void; onError: (err: unknown) => void }
        | undefined;
      mutateOf(trpc.jobs.progress.subscribe).mockImplementation(
        (_input: unknown, h: typeof handlers) => {
          handlers = h;
          return { unsubscribe: vi.fn() };
        },
      );

      fireEvent.input(screen.getByRole("textbox"), {
        target: { value: "alice" },
      });
      fireEvent.click(screen.getByRole("button", { name: "Offboard" }));

      await waitFor(() =>
        expect(trpc.friends.offboardStart.mutate).toHaveBeenCalledWith({
          friendId: 7,
        })
      );
      await waitFor(() => expect(handlers).toBeDefined());

      // Failures arrive as DATA events on the observer stream — the dialog
      // must freeze on the failing step and show the message.
      handlers?.onData({ type: "step", step: "storage" });
      handlers?.onData({
        type: "error",
        message: "mc rb failed",
        step: "storage",
      });
      expect(await screen.findByText(/mc rb failed/)).toBeInTheDocument();
    });

    it("does not call any mutation when the dialog is cancelled", () => {
      const friend = makeFriend();
      const { onClose } = renderDialog({ friend, kind: "rotate-s3" });

      fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

      expect(onClose).toHaveBeenCalledTimes(1);
      expect(trpc.friends.rotateKey.mutate).not.toHaveBeenCalled();
      expect(trpc.friends.suspend.mutate).not.toHaveBeenCalled();
    });
  });
});

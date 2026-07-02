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
      offboardStream: { subscribe: vi.fn() },
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

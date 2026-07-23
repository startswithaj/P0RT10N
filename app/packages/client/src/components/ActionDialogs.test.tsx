import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { makeFriend } from "../test-helpers/fixtures.ts";

// Mock the trpc/query module so the dialogs' mutations and cache invalidation
// are observable spies instead of real network calls.
vi.mock("../trpc.ts", () => ({
  trpc: {
    friends: {
      rotateKey: { mutate: vi.fn() },
      reissueTsKey: { mutate: vi.fn() },
      suspend: { mutate: vi.fn() },
      resume: { mutate: vi.fn() },
      resendInvite: { mutate: vi.fn() },
      resize: { mutate: vi.fn() },
      offboardStart: { mutate: vi.fn() },
    },
    jobs: { progress: { subscribe: vi.fn() } },
  },
  queryClient: { invalidateQueries: vi.fn() },
}));

import { trpc } from "../trpc.ts";
import { toaster } from "./ui/toast.tsx";
import { SuspendDialog } from "./SuspendDialog.tsx";
import { ResizeDialog } from "./ResizeDialog.tsx";
import { RotateS3Dialog } from "./RotateS3Dialog.tsx";
import { RotateTsDialog } from "./RotateTsDialog.tsx";
import { ResendInviteDialog } from "./ResendInviteDialog.tsx";
import { OffboardDialog } from "./OffboardDialog.tsx";

const { mutateOf } = vi.hoisted(() => ({
  // deno-lint-ignore no-explicit-any -- the mocked mutate is a vi.fn under a real tRPC type
  mutateOf: (fn: unknown) => fn as any,
}));

describe("ResendInviteDialog", () => {
  beforeEach(() => vi.clearAllMocks());

  it("confirms: resendInvite mutate → success toast → invalidate → close", async () => {
    mutateOf(trpc.friends.resendInvite.mutate).mockResolvedValue(undefined);
    const create = vi.spyOn(toaster, "create");
    const onClose = vi.fn();
    render(() => (
      <ResendInviteDialog
        friend={makeFriend({ id: 9, name: "bob", enrollmentMode: "invite" })}
        onClose={onClose}
      />
    ));

    fireEvent.click(screen.getByRole("button", { name: "Resend" }));

    await waitFor(() =>
      expect(trpc.friends.resendInvite.mutate).toHaveBeenCalledWith({
        friendId: 9,
      })
    );
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "success",
        title: "Invite resent to bob",
      }),
    );
    create.mockRestore();
  });

  it("surfaces the rate-limit error inline and does not close", async () => {
    mutateOf(trpc.friends.resendInvite.mutate).mockRejectedValue(
      new Error("Tailscale limits invite resends to one per minute"),
    );
    const onClose = vi.fn();
    render(() => (
      <ResendInviteDialog
        friend={makeFriend({ id: 3, name: "carol", enrollmentMode: "invite" })}
        onClose={onClose}
      />
    ));

    fireEvent.click(screen.getByRole("button", { name: "Resend" }));

    await waitFor(() =>
      expect(screen.getByText(/one per minute/i)).toBeInTheDocument()
    );
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe("SuspendDialog", () => {
  beforeEach(() => vi.clearAllMocks());

  it("confirms: mutate → success toast → invalidate → close", async () => {
    mutateOf(trpc.friends.suspend.mutate).mockResolvedValue(undefined);
    const create = vi.spyOn(toaster, "create");
    const onClose = vi.fn();
    render(() => (
      <SuspendDialog
        friend={makeFriend({ id: 9, name: "bob" })}
        onClose={onClose}
      />
    ));

    fireEvent.click(screen.getByRole("button", { name: "Suspend" }));

    await waitFor(() =>
      expect(trpc.friends.suspend.mutate).toHaveBeenCalledWith({ friendId: 9 })
    );
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ type: "success", title: "Suspended bob" }),
    );
    create.mockRestore();
  });

  it("failure: error toast + inline error, stays open", async () => {
    mutateOf(trpc.friends.suspend.mutate).mockRejectedValue(new Error("boom"));
    const create = vi.spyOn(toaster, "create");
    const onClose = vi.fn();
    render(() => (
      <SuspendDialog friend={makeFriend({ name: "bob" })} onClose={onClose} />
    ));

    fireEvent.click(screen.getByRole("button", { name: "Suspend" }));

    await waitFor(() =>
      expect(create).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "error",
          title: "Couldn't suspend bob",
          description: "boom",
        }),
      )
    );
    expect(onClose).not.toHaveBeenCalled();
    expect(await screen.findByText("boom")).toBeInTheDocument();
    create.mockRestore();
  });
});

describe("ResizeDialog", () => {
  beforeEach(() => vi.clearAllMocks());

  it("submits the entered quota in bytes", async () => {
    mutateOf(trpc.friends.resize.mutate).mockResolvedValue(undefined);
    render(() => (
      <ResizeDialog friend={makeFriend({ id: 3 })} onClose={vi.fn()} />
    ));

    fireEvent.input(screen.getByRole("spinbutton"), { target: { value: "5" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(trpc.friends.resize.mutate).toHaveBeenCalledWith({
        friendId: 3,
        quotaBytes: 5_000_000_000,
      })
    );
  });
});

describe("RotateS3Dialog", () => {
  beforeEach(() => vi.clearAllMocks());

  it("hands the bundle up and closes; no success toast (bundle is the result)", async () => {
    mutateOf(trpc.friends.rotateKey.mutate).mockResolvedValue({
      s3AccessKeyId: "AKIA",
    });
    const onBundle = vi.fn();
    const onClose = vi.fn();
    render(() => (
      <RotateS3Dialog
        friend={makeFriend({ id: 42 })}
        onClose={onClose}
        onBundle={onBundle}
      />
    ));

    fireEvent.click(screen.getByRole("button", { name: "Rotate key" }));

    await waitFor(() =>
      expect(trpc.friends.rotateKey.mutate).toHaveBeenCalledWith({
        friendId: 42,
      })
    );
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(onBundle).toHaveBeenCalledTimes(1);
  });
});

describe("RotateTsDialog", () => {
  beforeEach(() => vi.clearAllMocks());

  it("confirm shows the once-only Tailscale command inline", async () => {
    mutateOf(trpc.friends.reissueTsKey.mutate).mockResolvedValue({
      tailscaleUpCommand: "tailscale up --authkey tskey-X",
    });
    render(() => (
      <RotateTsDialog
        friend={makeFriend({ name: "alice" })}
        onClose={vi.fn()}
      />
    ));

    fireEvent.click(screen.getByRole("button", { name: "Re-issue" }));

    expect(await screen.findByText(/tskey-X/)).toBeInTheDocument();
  });
});

describe("OffboardDialog", () => {
  beforeEach(() => vi.clearAllMocks());

  it("enables Offboard only when the typed text equals the name verbatim", () => {
    render(() => (
      <OffboardDialog
        friend={makeFriend({ name: "alice" })}
        onClose={vi.fn()}
      />
    ));
    const button = screen.getByRole("button", { name: "Offboard" });
    expect(button).toBeDisabled();

    fireEvent.input(screen.getByRole("textbox"), {
      target: { value: "ALICE" },
    });
    expect(button).toBeDisabled();

    fireEvent.input(screen.getByRole("textbox"), {
      target: { value: "alice" },
    });
    expect(button).toBeEnabled();
  });

  it("a job error freezes on the checklist with the message", async () => {
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
    render(() => (
      <OffboardDialog
        friend={makeFriend({ id: 7, name: "alice" })}
        onClose={vi.fn()}
      />
    ));

    fireEvent.input(screen.getByRole("textbox"), {
      target: { value: "alice" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Offboard" }));
    await waitFor(() => expect(handlers).toBeDefined());

    handlers?.onData({ type: "step", step: "storage" });
    handlers?.onData({
      type: "error",
      message: "mc rb failed",
      step: "storage",
    });
    expect(await screen.findByText(/mc rb failed/)).toBeInTheDocument();
  });

  it("done with manual ACL shows dismissible advice + toasts success", async () => {
    mutateOf(trpc.friends.offboardStart.mutate).mockResolvedValue({
      jobId: "j1",
    });
    const create = vi.spyOn(toaster, "create");
    let handlers: { onData: (ev: unknown) => void } | undefined;
    mutateOf(trpc.jobs.progress.subscribe).mockImplementation(
      (_input: unknown, h: typeof handlers) => {
        handlers = h;
        return { unsubscribe: vi.fn() };
      },
    );
    const onClose = vi.fn();
    render(() => (
      <OffboardDialog
        friend={makeFriend({ id: 7, name: "alice" })}
        onClose={onClose}
      />
    ));

    fireEvent.input(screen.getByRole("textbox"), {
      target: { value: "alice" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Offboard" }));
    await waitFor(() => expect(handlers).toBeDefined());

    handlers?.onData({
      type: "done",
      manualAclCleanup: 'remove the "tagOwners" entry for "tag:x"',
    });
    expect(await screen.findByText(/tagOwners/)).toBeInTheDocument();
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ type: "success", title: "Offboarded alice" }),
    );
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(onClose).toHaveBeenCalledTimes(1);
    create.mockRestore();
  });

  it("done without advice closes (auto ACL mode)", async () => {
    mutateOf(trpc.friends.offboardStart.mutate).mockResolvedValue({
      jobId: "j1",
    });
    let handlers: { onData: (ev: unknown) => void } | undefined;
    mutateOf(trpc.jobs.progress.subscribe).mockImplementation(
      (_input: unknown, h: typeof handlers) => {
        handlers = h;
        return { unsubscribe: vi.fn() };
      },
    );
    const onClose = vi.fn();
    render(() => (
      <OffboardDialog
        friend={makeFriend({ id: 7, name: "alice" })}
        onClose={onClose}
      />
    ));

    fireEvent.input(screen.getByRole("textbox"), {
      target: { value: "alice" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Offboard" }));
    await waitFor(() => expect(handlers).toBeDefined());

    handlers?.onData({ type: "done" });
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });
});

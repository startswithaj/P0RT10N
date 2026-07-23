import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { addFriendInput } from "@p0rt1on/shared/domain";
import { AddPortion, type NewPortion } from "./AddPortion.tsx";

// Covers the add-friend form's submit gating and payload shape. Validation is
// delegated to the same `addFriendInput` schema the server enforces, so these
// tests encode that rule rather than a hand-rolled duplicate.
describe("AddPortion", () => {
  // Per-test helpers stay INSIDE describe (the no-test-globals lint plugin
  // forbids module-level const/function in *.test.* files).
  const setup = () => {
    const onSubmit = vi.fn<(data: NewPortion) => void>();
    const onBack = vi.fn();
    render(() => <AddPortion onBack={onBack} onSubmit={onSubmit} />);
    return { onSubmit, onBack };
  };

  const createBtn = () =>
    screen.getByRole("button", { name: "Create portion" }) as HTMLButtonElement;

  // The friend-name field is the only free-text input on the form.
  const nameField = () => screen.getAllByRole("textbox")[0];

  // Two NumberInputs render as spinbuttons: [0] = quota, [1] = retention.
  const numberFields = () =>
    screen.getAllByRole("spinbutton") as HTMLInputElement[];

  const form = () => document.querySelector("form") as HTMLFormElement;

  describe("name gating", () => {
    it("blocks submit while the name is empty — and says why", () => {
      const { onSubmit } = setup();

      // Default (empty) name: the CTA is disabled and the form guard refuses.
      expect(createBtn()).toBeDisabled();
      // CODE.md rule: a disabled button must state its reason.
      expect(screen.getByText("Enter a friend name to continue"))
        .toBeInTheDocument();
      fireEvent.submit(form());
      expect(onSubmit).not.toHaveBeenCalled();
    });

    it("blocks submit when the name violates the lowercase format", () => {
      const { onSubmit } = setup();

      // Uppercase fails friendNameSchema's `^[a-z0-9][a-z0-9-]*$` regex.
      fireEvent.input(nameField(), { target: { value: "Alice" } });
      expect(createBtn()).toBeDisabled();
      // The reason appears both as the field's error and the CTA hint.
      expect(screen.getAllByText(/lowercase letters/i).length)
        .toBeGreaterThanOrEqual(1);
      fireEvent.submit(form());
      expect(onSubmit).not.toHaveBeenCalled();

      // A leading hyphen is also rejected (must start alphanumeric).
      fireEvent.input(nameField(), { target: { value: "-alice" } });
      expect(createBtn()).toBeDisabled();
    });

    it("blocks names shorter than MinIO's 3-char bucket minimum", () => {
      const { onSubmit } = setup();

      // "do" is a valid-looking name whose bucket can never be created —
      // the schema now rejects it up front (min 3).
      fireEvent.input(nameField(), { target: { value: "do" } });
      expect(createBtn()).toBeDisabled();
      expect(screen.getAllByText(/at least 3 characters/i).length)
        .toBeGreaterThanOrEqual(1);
      fireEvent.submit(form());
      expect(onSubmit).not.toHaveBeenCalled();
    });

    it("enables submit once the name is valid", () => {
      setup();

      fireEvent.input(nameField(), { target: { value: "alice" } });
      expect(createBtn()).toBeEnabled();
    });

    it("does not flash the field error mid-word; blur settles it", () => {
      // "a" is invalid only because the word isn't finished — the red field
      // state waits for a typing pause (debounce) or blur. The CTA hint and
      // submit gating stay immediate.
      setup();

      fireEvent.input(nameField(), { target: { value: "a" } });
      expect(nameField()).not.toHaveAttribute("aria-invalid", "true");
      expect(createBtn()).toBeDisabled();

      fireEvent.blur(nameField());
      expect(nameField()).toHaveAttribute("aria-invalid", "true");
    });
  });

  describe("quota/retention rejection", () => {
    it("rejects empty, negative and fractional quota/retention input", () => {
      const { onSubmit } = setup();
      fireEvent.input(nameField(), { target: { value: "alice" } });

      // The NumberInput widget (min=1, integer format) refuses empty, negative
      // and fractional entries — such values never reach the signals, so the
      // submitted payload always carries the last valid positive integer.
      ["", "-5", "1.5"].forEach((bad) => {
        fireEvent.input(numberFields()[0], { target: { value: bad } });
        fireEvent.input(numberFields()[1], { target: { value: bad } });
      });

      fireEvent.submit(form());

      expect(onSubmit).toHaveBeenCalledTimes(1);
      const { enroll: _enroll, ...core } = onSubmit.mock.calls[0][0];
      // The invalid input was rejected: the payload still validates and keeps
      // the untouched defaults (30 GB quota, 14-day retention).
      expect(addFriendInput.safeParse(core).success).toBe(true);
      expect(core.quotaBytes).toBe(30_000_000_000);
      expect(core.retentionDays).toBe(14);
    });
  });

  describe("payload shape", () => {
    it("emits a payload whose fields exactly satisfy addFriendInput", () => {
      const { onSubmit } = setup();

      fireEvent.input(nameField(), { target: { value: "alice" } });
      fireEvent.submit(form());

      expect(onSubmit).toHaveBeenCalledTimes(1);
      const payload = onSubmit.mock.calls[0][0];
      expect(payload.enroll).toBe("key");

      // Drop the frontend-only enroll field; the rest must parse cleanly as an
      // AddFriendInput (schema injects the lockMode + enrollment defaults) with
      // exact values.
      const { enroll: _enroll, ...core } = payload;
      const parsed = addFriendInput.parse(core);
      expect(parsed).toEqual({
        name: "alice",
        quotaBytes: 30_000_000_000,
        retentionDays: 14,
        isolationMode: "dedicated",
        lockMode: "GOVERNANCE",
        enrollment: { mode: "authKey" },
      });
    });
  });

  describe("invite enrollment", () => {
    const renderWith = (inviteApiConfigured: boolean) => {
      const onSubmit = vi.fn<(data: NewPortion) => void>();
      render(() => (
        <AddPortion
          onBack={vi.fn()}
          onSubmit={onSubmit}
          inviteApiConfigured={inviteApiConfigured}
        />
      ));
      return { onSubmit };
    };

    const emailField = () => screen.findByPlaceholderText("friend@example.com");

    const pickInvite = () =>
      fireEvent.click(
        screen.getByRole("radio", { name: /Invite to tailnet/i }),
      );

    const warning = () =>
      screen.queryByText(/can do everything except create invites/i);

    it("shows the not-configured warning (invite + no token)", async () => {
      renderWith(false);
      pickInvite();
      await emailField();
      expect(warning()).toBeInTheDocument();
    });

    it("shows no warning when the invite API is configured", async () => {
      renderWith(true);
      pickInvite();
      await emailField();
      expect(warning()).toBeNull();
    });

    it("blocks submit until a valid email is entered", async () => {
      renderWith(true);
      fireEvent.input(nameField(), { target: { value: "alice" } });
      pickInvite();
      const email = await emailField();

      expect(createBtn()).toBeDisabled(); // no email yet
      fireEvent.input(email, { target: { value: "not-an-email" } });
      expect(createBtn()).toBeDisabled();
      fireEvent.input(email, { target: { value: "bob@example.com" } });
      expect(createBtn()).toBeEnabled();
    });

    it("emits an invite enrollment payload; the warning never blocks submit", async () => {
      const { onSubmit } = renderWith(false);
      fireEvent.input(nameField(), { target: { value: "alice" } });
      pickInvite();
      const email = await emailField();
      fireEvent.input(email, { target: { value: "bob@example.com" } });

      // The advisory is visible, but submit is still enabled (a hint, not a gate).
      expect(warning()).toBeInTheDocument();
      expect(createBtn()).toBeEnabled();

      fireEvent.submit(form());
      expect(onSubmit).toHaveBeenCalledTimes(1);
      const payload = onSubmit.mock.calls[0][0];
      expect(payload.enroll).toBe("invite");
      expect(payload.enrollment).toEqual({
        mode: "invite",
        email: "bob@example.com",
      });
    });
  });

  describe("isolation-mode selection", () => {
    it("shows the soft-isolation banner only while Shared is selected", async () => {
      setup();

      // Dedicated (default): no banner.
      expect(screen.queryByText(/IAM-policy level/i)).toBeNull();

      fireEvent.click(screen.getByRole("radio", { name: /Shared/i }));
      expect(await screen.findByText(/IAM-policy level/i)).toBeInTheDocument();

      fireEvent.click(screen.getByRole("radio", { name: /Dedicated/i }));
      await waitFor(() =>
        expect(screen.queryByText(/IAM-policy level/i)).toBeNull()
      );
    });

    it("carries the selected RadioGroup mode into the payload", async () => {
      const { onSubmit } = setup();
      fireEvent.input(nameField(), { target: { value: "alice" } });

      // Zag's radio machine commits on a microtask, so wait for the item's
      // data-state to flip before submitting.
      fireEvent.click(screen.getByRole("radio", { name: /Shared/i }));
      await waitFor(() => {
        const items = document.querySelectorAll("[data-part='item']");
        expect(items[1].getAttribute("data-state")).toBe("checked");
      });

      fireEvent.submit(form());

      expect(onSubmit).toHaveBeenCalledTimes(1);
      expect(onSubmit.mock.calls[0][0].isolationMode).toBe("shared");
    });
  });
});

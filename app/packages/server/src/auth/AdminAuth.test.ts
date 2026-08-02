import { describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { AdminAuth } from "./AdminAuth.ts";

describe("AdminAuth", () => {
  const creds = { username: "admin", password: "correct-horse-battery" };

  // Array.fromAsync awaits each attempt in turn, so the failures still land in
  // order — the 4th is the one that arms the lockout.
  const failFourTimes = (auth: AdminAuth): Promise<boolean[]> =>
    Array.fromAsync([0, 1, 2, 3], () => auth.verify("admin", "wrong"));

  it("disabled() validates nothing", () => {
    const auth = AdminAuth.disabled();
    expect(auth.enabled).toBe(false);
    expect(auth.validate("anything")).toBe(false);
  });

  it("verify accepts the right credentials, rejects wrong ones", async () => {
    const auth = await AdminAuth.create(creds);
    expect(auth.enabled).toBe(true);
    expect(await auth.verify("admin", "correct-horse-battery")).toBe(true);
    expect(await auth.verify("admin", "wrong")).toBe(false);
    expect(await auth.verify("root", "correct-horse-battery")).toBe(false);
  });

  it("createSession → validate; destroy invalidates", async () => {
    const auth = await AdminAuth.create(creds);
    const token = auth.createSession();
    expect(auth.validate(token)).toBe(true);
    auth.destroy(token);
    expect(auth.validate(token)).toBe(false);
    expect(auth.validate("never-issued")).toBe(false);
  });

  it("sessions expire after the TTL", async () => {
    const clock = { t: 1_000 };
    const auth = await AdminAuth.create(creds, () => clock.t);
    const token = auth.createSession();
    expect(auth.validate(token)).toBe(true);
    // Advance past the 7-day TTL.
    clock.t += 8 * 24 * 60 * 60 * 1000;
    expect(auth.validate(token)).toBe(false);
  });

  it("does not throttle until failures exceed the threshold", async () => {
    const clock = { t: 0 };
    const auth = await AdminAuth.create(creds, () => clock.t);
    expect(await auth.verify("admin", "wrong")).toBe(false);
    expect(await auth.verify("admin", "wrong")).toBe(false);
    expect(await auth.verify("admin", "wrong")).toBe(false);
    // Still within the threshold: a correct attempt right after still succeeds.
    expect(await auth.verify("admin", "correct-horse-battery")).toBe(true);
  });

  it("locks out once failures exceed the threshold, rejecting even correct creds", async () => {
    const clock = { t: 0 };
    const auth = await AdminAuth.create(creds, () => clock.t);
    expect(await failFourTimes(auth)).toEqual([false, false, false, false]);
    // The 4th failure armed a lockout; the right password is rejected while locked.
    expect(await auth.verify("admin", "correct-horse-battery")).toBe(false);
  });

  it("a rejected attempt during lockout does not extend it", async () => {
    const clock = { t: 0 };
    const auth = await AdminAuth.create(creds, () => clock.t);
    await failFourTimes(auth);
    // 4th failure sets a 2s lockout (BASE_DELAY_MS * 2^(4-3)).
    clock.t += 500;
    expect(await auth.verify("admin", "wrong")).toBe(false); // still locked
    clock.t = 2_000; // exactly when the original lockout expires
    expect(await auth.verify("admin", "correct-horse-battery")).toBe(true);
  });

  it("an attempt at/after lockout expiry is let through", async () => {
    const clock = { t: 0 };
    const auth = await AdminAuth.create(creds, () => clock.t);
    await failFourTimes(auth);
    clock.t = 1_999;
    expect(await auth.verify("admin", "correct-horse-battery")).toBe(false); // still locked
    clock.t = 2_000;
    expect(await auth.verify("admin", "correct-horse-battery")).toBe(true); // expired
  });

  it("a successful verify resets the failure count", async () => {
    const clock = { t: 0 };
    const auth = await AdminAuth.create(creds, () => clock.t);
    expect(await auth.verify("admin", "wrong")).toBe(false);
    expect(await auth.verify("admin", "wrong")).toBe(false);
    expect(await auth.verify("admin", "correct-horse-battery")).toBe(true);
    // 3 more failures post-reset are still under the threshold, not locked out.
    expect(await auth.verify("admin", "wrong")).toBe(false);
    expect(await auth.verify("admin", "wrong")).toBe(false);
    expect(await auth.verify("admin", "wrong")).toBe(false);
    expect(await auth.verify("admin", "correct-horse-battery")).toBe(true);
  });
});

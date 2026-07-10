import { describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { AdminAuth } from "./AdminAuth.ts";

describe("AdminAuth", () => {
  const creds = { username: "admin", password: "correct-horse-battery" };

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
});

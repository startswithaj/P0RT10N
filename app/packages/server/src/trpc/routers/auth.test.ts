import { describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { createCallerFactory, protectedProcedure, router } from "../trpc.ts";
import type { TrpcContext } from "../trpc.ts";
import { appRouter } from "../root.ts";
import { AdminAuth } from "../../auth/AdminAuth.ts";
import { noopLogger } from "../../test-helpers/mocks.ts";

describe("auth router", () => {
  const creds = { username: "admin", password: "hunter2-hunter2" };

  // auth.* is the only public surface; it touches ctx.auth/logger/session/
  // headers only, so a cast context (no real services) is enough to exercise it.
  const ctxFor = (
    auth: AdminAuth,
    over: { sessionToken?: string; secureCookie?: boolean } = {},
  ): TrpcContext =>
    ({
      auth,
      logger: noopLogger(),
      responseHeaders: new Headers(),
      ...over,
    }) as unknown as TrpcContext;

  const call = createCallerFactory(appRouter);

  it("disabled auth: status reports enabled=false, authenticated=true", async () => {
    const status = await call(ctxFor(AdminAuth.disabled())).auth.status();
    expect(status).toEqual({ enabled: false, authenticated: true });
    // login is a no-op that still succeeds.
    expect(await call(ctxFor(AdminAuth.disabled())).auth.login(creds)).toEqual({
      ok: true,
    });
  });

  it("login: wrong creds throw UNAUTHORIZED; right creds set a session cookie", async () => {
    const auth = await AdminAuth.create(creds);

    await expect(
      call(ctxFor(auth)).auth.login({ username: "admin", password: "nope" }),
    ).rejects.toThrow("invalid credentials");

    const ctx = ctxFor(auth);
    expect(await call(ctx).auth.login(creds)).toEqual({ ok: true });
    const cookie = ctx.responseHeaders?.get("Set-Cookie") ?? "";
    expect(cookie).toContain("p0rt1on_session=");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Strict");
    // No proxy https signal → no Secure flag (keeps dev-over-http working).
    expect(cookie).not.toContain("Secure");
  });

  it("status reflects a live session; logout invalidates it", async () => {
    const auth = await AdminAuth.create(creds);
    const token = auth.createSession();

    expect(await call(ctxFor(auth, { sessionToken: token })).auth.status())
      .toEqual({ enabled: true, authenticated: true });
    // No token → not authenticated.
    expect(await call(ctxFor(auth)).auth.status())
      .toEqual({ enabled: true, authenticated: false });

    await call(ctxFor(auth, { sessionToken: token })).auth.logout();
    expect(await call(ctxFor(auth, { sessionToken: token })).auth.status())
      .toEqual({ enabled: true, authenticated: false });
  });

  it("login sets the Secure flag when the proxy signals https", async () => {
    const auth = await AdminAuth.create(creds);
    const ctx = ctxFor(auth, { secureCookie: true });
    await call(ctx).auth.login(creds);
    expect(ctx.responseHeaders?.get("Set-Cookie")).toContain("Secure");
  });

  // protectedProcedure semantics, isolated via a one-off protected route.
  const guarded = router({ ping: protectedProcedure.query(() => "pong") });
  const callGuarded = createCallerFactory(guarded);

  it("protectedProcedure: auth off allows; auth on needs a valid session", async () => {
    const auth = await AdminAuth.create(creds);
    // Auth off → passes straight through.
    expect(await callGuarded(ctxFor(AdminAuth.disabled())).ping()).toBe("pong");
    // Auth on, no session → rejected.
    await expect(callGuarded(ctxFor(auth)).ping()).rejects.toThrow(
      "authentication required",
    );
    // Auth on, valid session → allowed.
    const token = auth.createSession();
    expect(await callGuarded(ctxFor(auth, { sessionToken: token })).ping())
      .toBe("pong");
  });
});

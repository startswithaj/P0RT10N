import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { publicProcedure, router } from "../trpc.ts";

/** Session cookie name — shared with the server's per-request cookie parse. */
export const SESSION_COOKIE = "p0rt1on_session";
const MAX_AGE_SECONDS = 7 * 24 * 60 * 60; // 7 days

function sessionCookie(token: string, maxAge: number, secure: boolean): string {
  const flags = ["HttpOnly", "SameSite=Strict", "Path=/", `Max-Age=${maxAge}`];
  if (secure) flags.push("Secure");
  return `${SESSION_COOKIE}=${token}; ${flags.join("; ")}`;
}

/** Public auth endpoints (the only procedures reachable without a session). */
export const authRouter = router({
  /** Whether auth is on, and whether THIS request is authenticated. */
  status: publicProcedure.query(({ ctx }) => ({
    enabled: ctx.auth.enabled,
    authenticated: !ctx.auth.enabled ||
      (!!ctx.sessionToken && ctx.auth.validate(ctx.sessionToken)),
  })),

  login: publicProcedure
    .input(z.object({ username: z.string(), password: z.string() }))
    .mutation(async ({ ctx, input }) => {
      if (!ctx.auth.enabled) return { ok: true };
      if (!(await ctx.auth.verify(input.username, input.password))) {
        // Generic message — never distinguish username from password.
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "invalid credentials",
        });
      }
      const token = ctx.auth.createSession();
      ctx.responseHeaders?.append(
        "Set-Cookie",
        sessionCookie(token, MAX_AGE_SECONDS, ctx.secureCookie ?? false),
      );
      await ctx.auditService.record("login");
      return { ok: true };
    }),

  logout: publicProcedure.mutation(async ({ ctx }) => {
    if (ctx.sessionToken) ctx.auth.destroy(ctx.sessionToken);
    ctx.responseHeaders?.append(
      "Set-Cookie",
      sessionCookie("", 0, ctx.secureCookie ?? false),
    );
    await ctx.auditService.record("logout");
    return { ok: true };
  }),
});

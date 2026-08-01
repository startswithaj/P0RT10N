import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { publicProcedure, router } from "../trpc.ts";

/** Session cookie name; must match the name server.ts uses when parsing the request cookie. */
export const SESSION_COOKIE = "p0rt1on_session";
const MAX_AGE_SECONDS = 7 * 24 * 60 * 60;

function sessionCookie(token: string, maxAge: number, secure: boolean): string {
  const flags = ["HttpOnly", "SameSite=Strict", "Path=/", `Max-Age=${maxAge}`];
  if (secure) flags.push("Secure");
  return `${SESSION_COOKIE}=${token}; ${flags.join("; ")}`;
}

/** The only procedures reachable without a session; every other router requires one. */
export const authRouter = router({
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
        // Generic message; never reveal whether the username or password was wrong.
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

import { initTRPC, TRPCError } from "@trpc/server";
import type { ManagerCapabilities } from "@p0rt1on/shared/domain";
import { ServiceError } from "../lib/ServiceError.ts";
import type { AdminAuth } from "../auth/AdminAuth.ts";
import type {
  ActivityService,
  AuditService,
  FriendService,
  InventoryService,
  Logger,
  ProvisioningService,
  SystemHealthService,
  UsageService,
} from "../services/types.ts";
import type { JobService } from "../jobs/JobService.ts";

/** Dependencies injected into every request. Routers read these; never globals. */
export interface TrpcContext {
  friendService: FriendService;
  provisioningService: ProvisioningService;
  usageService: UsageService;
  activityService: ActivityService;
  auditService: AuditService;
  inventoryService: InventoryService;
  systemHealthService: SystemHealthService;
  jobService: JobService;
  capabilities: ManagerCapabilities;
  logger: Logger;
  /** Admin auth; when disabled, protectedProcedure allows every request through. */
  auth: AdminAuth;
  sessionToken?: string;
  /** True when the external request was HTTPS per the X-Forwarded-Proto proxy header; controls the cookie's Secure flag. */
  secureCookie?: boolean;
  responseHeaders?: Headers;
}

const t = initTRPC.context<TrpcContext>().create({
  sse: {
    ping: { enabled: true, intervalMs: 10_000 },
    client: { reconnectAfterInactivityMs: 30_000 },
  },
});

/**
 * Maps domain errors to TRPCErrors so routers never need try/catch.
 * In tRPC v11, next() returns a result instead of throwing, so a failure appears as result.ok === false with the cause in result.error.cause.
 */
const errorMiddleware = t.middleware(async ({ next }) => {
  const result = await next();
  if (!result.ok) {
    const cause = result.error.cause;
    if (cause instanceof ServiceError) {
      throw new TRPCError({ code: cause.code, message: cause.message });
    }
  }
  return result;
});

/**
 * Wraps the error middleware, so by the time it logs, any domain error has
 * already been mapped to its final TRPCError.
 */
const loggingMiddleware = t.middleware(async ({ ctx, path, type, next }) => {
  const start = Date.now();
  ctx.logger.debug("rpc start", { path, type });
  const result = await next();
  const ms = Date.now() - start;
  if (result.ok) {
    ctx.logger.info("rpc ok", { path, type, ms });
  } else {
    ctx.logger.warn("rpc error", {
      path,
      type,
      ms,
      code: result.error.code,
      error: result.error.message,
    });
    // This is the failed half of the audit trail: every errored admin mutation, including auth, is recorded; queries are skipped since they aren't actions.
    // This write is best-effort; it must never turn one failure into two.
    if (type === "mutation") {
      await ctx.auditService.record(
        "action_failed",
        `${path}: ${result.error.message}`,
      ).catch((err) =>
        ctx.logger.error("audit record failed", { error: String(err) })
      );
    }
  }
  return result;
});

/**
 * Wraps a subscription generator so mid-stream throws get logged before reaching the SSE transport.
 * Middleware can't do this because for subscriptions, next() resolves as soon as the generator is created, so later errors would otherwise vanish from the log.
 */
export async function* loggedStream<T>(
  gen: AsyncGenerator<T>,
  logger: Logger,
  path: string,
): AsyncGenerator<T> {
  try {
    yield* gen;
  } catch (err) {
    logger.warn("stream error", { path, error: String(err) });
    throw err;
  }
}

/** Rejects unauthenticated calls when auth is enabled; a no-op when auth is off. */
const authMiddleware = t.middleware(({ ctx, next }) => {
  if (!ctx.auth.enabled) return next();
  if (!ctx.sessionToken || !ctx.auth.validate(ctx.sessionToken)) {
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: "authentication required",
    });
  }
  return next();
});

export const router = t.router;
export const publicProcedure = t.procedure
  .use(loggingMiddleware)
  .use(errorMiddleware);
/** Every admin procedure requires a valid session; auth.* endpoints stay public by using publicProcedure instead. */
export const protectedProcedure = publicProcedure.use(authMiddleware);
export const createCallerFactory = t.createCallerFactory;

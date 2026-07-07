import { initTRPC, TRPCError } from "@trpc/server";
import { ServiceError } from "../lib/ServiceError.ts";
import type {
  ActivityService,
  FriendService,
  InventoryService,
  Logger,
  ProvisioningService,
  UsageService,
} from "../services/types.ts";
import type { JobService } from "../jobs/JobService.ts";

/** Dependencies injected into every request. Routers read these; never globals. */
export interface TrpcContext {
  friendService: FriendService;
  provisioningService: ProvisioningService;
  usageService: UsageService;
  activityService: ActivityService;
  inventoryService: InventoryService;
  jobService: JobService;
  logger: Logger;
  // Populated by the HTTP adapter for the local-only admin session.
  responseHeaders?: Headers;
}

const t = initTRPC.context<TrpcContext>().create({
  sse: {
    // Keep the activity stream alive + detect dead connections.
    ping: { enabled: true, intervalMs: 10_000 },
    client: { reconnectAfterInactivityMs: 30_000 },
  },
});

/**
 * Maps domain errors to TRPCErrors so routers need no try/catch and services
 * stay transport-agnostic. In tRPC v11 next() returns a result rather than
 * throwing; when result.ok is false the original error is in result.error.cause.
 * (chargeHA pattern.)
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
 * Per-call logging. Emits a debug line on entry and an info/warn line on exit
 * with the path, type and elapsed ms — so every RPC is traceable. Wraps the
 * error middleware so it observes the final (possibly mapped) outcome.
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
  }
  return result;
});

/**
 * Wrap a subscription generator so mid-stream throws are logged before they
 * reach the SSE transport. Middleware can't do this: for subscriptions next()
 * resolves when the generator is created, so errors thrown while streaming
 * bypass both middlewares and would otherwise vanish from the server log.
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

export const router = t.router;
export const mergeRouters = t.mergeRouters;
export const publicProcedure = t.procedure
  .use(loggingMiddleware)
  .use(errorMiddleware);
export const createCallerFactory = t.createCallerFactory;

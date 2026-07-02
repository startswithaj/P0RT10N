import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { serveDir, serveFile } from "@std/http/file-server";
import { join } from "@std/path";
import { appRouter } from "./trpc/root.ts";
import type { TrpcContext } from "./trpc/trpc.ts";

const TRPC_ENDPOINT = "/trpc";
const AUDIT_ENDPOINT = "/internal/audit";

/** Token-guarded MinIO audit-webhook sink (loopback only, not on any tailnet). */
export interface AuditHook {
  token: string;
  /** Ingest one raw audit event (parse + aggregate). */
  onEvent: (raw: unknown) => Promise<void>;
}

export interface ServerOptions {
  port: number;
  /**
   * Bind address. Default loopback (admin surface is local per PLAN). Set to
   * `0.0.0.0` when containerized so instance containers can POST the audit
   * webhook back to the manager via the host gateway.
   */
  hostname?: string;
  context: TrpcContext;
  /** Receiver for MinIO's audit webhook; omit to disable the endpoint. */
  audit?: AuditHook;
  /**
   * Built SPA assets dir to serve for non-API routes (production). Omit in dev —
   * the Vite dev server serves the frontend, so the API only handles tRPC.
   */
  staticDir?: string;
  /** Aborts the server (used by tests for clean shutdown). */
  signal?: AbortSignal;
  /** Called once the listener is bound (tests await this for the real port). */
  onListen?: (addr: { port: number }) => void;
}

/** Handle a MinIO audit webhook POST: token-guard, parse, fan out to onEvent. */
async function handleAudit(req: Request, audit: AuditHook): Promise<Response> {
  if (req.method !== "POST") {
    return new Response("method not allowed", { status: 405 });
  }
  if ((req.headers.get("authorization") ?? "") !== `Bearer ${audit.token}`) {
    return new Response("unauthorized", { status: 401 });
  }
  const body = await req.json().catch(() => null);
  if (body === null) return new Response("bad request", { status: 400 });
  const events = Array.isArray(body) ? body : [body];
  await Promise.all(events.map((e) => audit.onEvent(e)));
  return new Response(null, { status: 204 });
}

/**
 * Serve the built SPA from `fsRoot`, falling back to `index.html` for paths
 * with no matching file so client-side routes (deep links, reload) work.
 */
async function handleStatic(req: Request, fsRoot: string): Promise<Response> {
  const res = await serveDir(req, { fsRoot, quiet: true });
  if (res.status === 404) return serveFile(req, join(fsRoot, "index.html"));
  return res;
}

/**
 * Serve the tRPC router over HTTP. Local-only admin surface (PLAN): bind to
 * loopback. `/health` is a plain liveness check; `/internal/audit` receives
 * MinIO's audit webhook (token-guarded); `/trpc` routes to tRPC. When
 * `staticDir` is set (production), everything else serves the built SPA; in dev
 * it's unset and non-API requests fall through to tRPC (Vite serves the UI).
 */
export function startServer(opts: ServerOptions): Deno.HttpServer {
  const handleTrpc = (req: Request) =>
    fetchRequestHandler({
      endpoint: TRPC_ENDPOINT,
      req,
      router: appRouter,
      createContext: () => opts.context,
    });
  return Deno.serve({
    port: opts.port,
    hostname: opts.hostname ?? "127.0.0.1",
    signal: opts.signal,
    onListen: opts.onListen,
  }, (req) => {
    const url = new URL(req.url);
    if (url.pathname === "/health") {
      return new Response("ok", { status: 200 });
    }
    if (url.pathname === AUDIT_ENDPOINT && opts.audit) {
      return handleAudit(req, opts.audit);
    }
    if (url.pathname.startsWith(TRPC_ENDPOINT)) {
      return handleTrpc(req);
    }
    if (opts.staticDir) {
      return handleStatic(req, opts.staticDir);
    }
    return handleTrpc(req);
  });
}

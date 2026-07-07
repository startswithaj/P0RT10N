import { createHash, timingSafeEqual } from "node:crypto";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { serveDir, serveFile } from "@std/http/file-server";
import { LimitedBytesTransformStream } from "@std/streams/limited-bytes-transform-stream";
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

/** Audit events are small JSON objects; anything past this is not MinIO. */
const MAX_AUDIT_BODY_BYTES = 1024 * 1024;

/**
 * Constant-time string equality: compare fixed-length SHA-256 digests so
 * neither content nor length differences shortcut (node's timingSafeEqual
 * throws on unequal lengths, so raw bytes can't be compared directly).
 */
function safeEqual(a: string, b: string): boolean {
  const ha = createHash("sha256").update(a).digest();
  const hb = createHash("sha256").update(b).digest();
  return timingSafeEqual(ha, hb);
}

/** JSON.parse to a value or null — malformed input is a 400, not a throw. */
function parseJson(text: string): unknown | null {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** Handle a MinIO audit webhook POST: token-guard, parse, fan out to onEvent. */
async function handleAudit(req: Request, audit: AuditHook): Promise<Response> {
  if (req.method !== "POST") {
    return new Response("method not allowed", { status: 405 });
  }
  const auth = req.headers.get("authorization") ?? "";
  if (!safeEqual(auth, `Bearer ${audit.token}`)) {
    return new Response("unauthorized", { status: 401 });
  }
  // Reject oversized payloads BEFORE reading the body into memory — declared
  // size first, then a hard streaming cap for bodies with no Content-Length.
  if (Number(req.headers.get("content-length") ?? "0") > MAX_AUDIT_BODY_BYTES) {
    return new Response("payload too large", { status: 413 });
  }
  const capped = req.body?.pipeThrough(
    new LimitedBytesTransformStream(MAX_AUDIT_BODY_BYTES, { error: true }),
  );
  const text = await new Response(capped ?? "").text().catch(() => null);
  if (text === null) return new Response("payload too large", { status: 413 });
  const body = parseJson(text);
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

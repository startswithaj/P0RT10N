import { createHash, timingSafeEqual } from "node:crypto";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { serveDir, serveFile } from "@std/http/file-server";
import { LimitedBytesTransformStream } from "@std/streams/limited-bytes-transform-stream";
import { join } from "@std/path";
import { appRouter } from "./trpc/root.ts";
import type { TrpcContext } from "./trpc/trpc.ts";
import { SESSION_COOKIE } from "./trpc/routers/auth.ts";
import { MINIO_EVENT_PATH } from "./lib/Env.ts";

const TRPC_ENDPOINT = "/trpc";
const MINIO_EVENT_ENDPOINT = MINIO_EVENT_PATH;

/** Read one cookie value from a Cookie header (undefined if absent). */
function readCookie(header: string | null, name: string): string | undefined {
  return header
    ?.split(/;\s*/)
    .find((c) => c.startsWith(`${name}=`))
    ?.slice(name.length + 1);
}

/** Token-guarded MinIO audit-webhook sink (loopback/container-net only). */
export interface MinioEventSink {
  token: string;
  /** Publish one raw event to the bus. Sync + non-blocking by contract. */
  onEvent: (raw: unknown) => void;
}

export interface ServerOptions {
  port: number;
  context: TrpcContext;
  /** Admin listener bind. Defaults to this machine (127.0.0.1); a wider bind is
   * allowed without auth (main.ts warns). */
  bindHost?: string;
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

export interface MinioEventServerOptions {
  port: number;
  /**
   * Bind address for the audit listener. `0.0.0.0` when containerized so
   * instance containers can POST events via the host gateway — safe because
   * this listener serves ONLY the token-guarded webhook, never the admin API.
   */
  hostname?: string;
  sink: MinioEventSink;
  signal?: AbortSignal;
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
async function handleMinioEvent(
  req: Request,
  sink: MinioEventSink,
): Promise<Response> {
  if (req.method !== "POST") {
    return new Response("method not allowed", { status: 405 });
  }
  const auth = req.headers.get("authorization") ?? "";
  if (!safeEqual(auth, `Bearer ${sink.token}`)) {
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
  // publish is non-blocking and never throws — fan out directly (a 204 means
  // "enqueued", not "persisted"; consumers fold/forward off the bus).
  events.forEach((e) => sink.onEvent(e));
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
 * Serve the tRPC router over HTTP. The admin surface binds this machine
 * (127.0.0.1) by default; a wider bind (`P0RT1ON_ADMIN_BIND_HOST`, e.g. behind a
 * TLS proxy) is allowed without auth — main.ts warns and the UI banners it.
 * `/health` is a plain liveness check; `/trpc` routes to tRPC.
 * The audit webhook is deliberately NOT here (see startMinioEventServer): serving
 * it from this listener once forced `0.0.0.0` binds that exposed the whole
 * unauthenticated admin API to every container. When `staticDir` is set
 * (production), everything else serves the built SPA; in dev it's unset and
 * non-API requests fall through to tRPC (Vite serves the UI).
 */
export function startServer(opts: ServerOptions): Deno.HttpServer {
  // A wider bind without a password no longer refuses to boot — main.ts warns
  // instead (and the UI banners it). `bind` is the listener address below.
  const bind = opts.bindHost ?? "127.0.0.1";

  const handleTrpc = (req: Request) =>
    fetchRequestHandler({
      endpoint: TRPC_ENDPOINT,
      req,
      router: appRouter,
      // Per-request: parse the session cookie + note the proxy's scheme, and
      // hand the adapter's resHeaders through for Set-Cookie.
      createContext: ({ resHeaders }) => ({
        ...opts.context,
        sessionToken: readCookie(req.headers.get("cookie"), SESSION_COOKIE),
        secureCookie:
          (req.headers.get("x-forwarded-proto") ?? "").toLowerCase() ===
            "https",
        responseHeaders: resHeaders,
      }),
    });

  return Deno.serve({
    port: opts.port,
    hostname: bind,
    signal: opts.signal,
    onListen: opts.onListen,
  }, (req) => {
    const url = new URL(req.url);
    if (url.pathname === "/health") {
      return new Response("ok", { status: 200 });
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

/**
 * The network-exposed sibling: serves ONLY the token-guarded audit webhook
 * (plus `/health` for container healthchecks) so instance containers can
 * deliver events without the admin API ever leaving loopback. Every other
 * path — including anything tRPC-shaped — is a 404 by construction.
 */
export function startMinioEventServer(
  opts: MinioEventServerOptions,
): Deno.HttpServer {
  return Deno.serve({
    port: opts.port,
    hostname: opts.hostname ?? "0.0.0.0",
    signal: opts.signal,
    onListen: opts.onListen,
  }, (req) => {
    const url = new URL(req.url);
    if (url.pathname === "/health") {
      return new Response("ok", { status: 200 });
    }
    if (url.pathname === MINIO_EVENT_ENDPOINT) {
      return handleMinioEvent(req, opts.sink);
    }
    return new Response("not found", { status: 404 });
  });
}

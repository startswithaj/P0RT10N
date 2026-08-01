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

function readCookie(header: string | null, name: string): string | undefined {
  return header
    ?.split(/;\s*/)
    .find((c) => c.startsWith(`${name}=`))
    ?.slice(name.length + 1);
}

/** Token-guarded audit-webhook sink, reachable only from loopback or the container network. */
export interface MinioEventSink {
  token: string;
  /** Must be synchronous and non-blocking. */
  onEvent: (raw: unknown) => void;
}

export interface ServerOptions {
  port: number;
  context: TrpcContext;
  /** Defaults to 127.0.0.1; a wider bind is allowed without auth and main.ts
   * warns instead of refusing to boot. */
  bindHost?: string;
  staticDir?: string;
  signal?: AbortSignal;
  onListen?: (addr: { port: number }) => void;
}

export interface MinioEventServerOptions {
  port: number;
  /**
   * Defaults to 0.0.0.0 when containerized so containers reach it via the host gateway.
   * This is safe: the listener serves only the token-guarded webhook, never the admin API.
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

function parseJson(text: string): unknown | null {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

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
  // Rejects oversized payloads before reading the body into memory, checking
  // the declared size first and applying a hard streaming cap for bodies with no Content-Length.
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
  // Publish is non-blocking and never throws, so events fan out directly here.
  // A 204 response means the event was enqueued, not persisted.
  events.forEach((e) => sink.onEvent(e));
  return new Response(null, { status: 204 });
}

async function handleStatic(req: Request, fsRoot: string): Promise<Response> {
  const res = await serveDir(req, { fsRoot, quiet: true });
  if (res.status === 404) return serveFile(req, join(fsRoot, "index.html"));
  return res;
}

/**
 * The audit webhook is deliberately not served from this listener.
 * Combining them once forced a 0.0.0.0 bind that exposed the whole unauthenticated admin API to every container.
 */
export function startServer(opts: ServerOptions): Deno.HttpServer {
  const bind = opts.bindHost ?? "127.0.0.1";

  const handleTrpc = (req: Request) =>
    fetchRequestHandler({
      endpoint: TRPC_ENDPOINT,
      req,
      router: appRouter,
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
 * Serves only the token-guarded audit webhook and /health, so instance
 * containers can reach it without the admin API ever leaving loopback. Every other path is a 404 by construction.
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

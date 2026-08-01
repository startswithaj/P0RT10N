import { describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { startMinioEventServer, startServer } from "./server.ts";
import { buildContext } from "./app.ts";
import { createTestDatabase } from "./test-helpers/testDb.ts";
import { noopLogger, testEnv } from "./test-helpers/mocks.ts";

describe("startServer (HTTP)", () => {
  it("serves /health and the tRPC router on loopback", async () => {
    const database = createTestDatabase();
    const context = await buildContext(database, testEnv(), noopLogger());
    const abort = new AbortController();
    const listening = Promise.withResolvers<number>();
    const server = startServer({
      port: 0,
      context,
      signal: abort.signal,
      onListen: ({ port }) => listening.resolve(port),
    });
    const port = await listening.promise;

    try {
      const health = await fetch(`http://127.0.0.1:${port}/health`);
      expect(health.status).toBe(200);
      expect(await health.text()).toBe("ok");

      const res = await fetch(`http://127.0.0.1:${port}/trpc/friends.list`);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(Array.isArray(body.result.data)).toBe(true);
    } finally {
      abort.abort();
      await server.finished;
      database.driver.close();
    }
  });

  it("admin listener does NOT serve the audit webhook", async () => {
    // The webhook lives on its own listener so the admin API never needs a
    // non-loopback bind. The admin listener must not even route this path.
    const database = createTestDatabase();
    const context = await buildContext(database, testEnv(), noopLogger());
    const abort = new AbortController();
    const listening = Promise.withResolvers<number>();
    const server = startServer({
      port: 0,
      context,
      signal: abort.signal,
      onListen: ({ port }) => listening.resolve(port),
    });
    const port = await listening.promise;

    try {
      const res = await fetch(
        `http://127.0.0.1:${port}/internal/minio-events`,
        {
          method: "POST",
          headers: { authorization: "Bearer anything" },
          body: "{}",
        },
      );
      // This falls through to tRPC because no matching procedure exists; it never reaches handleMinioEvent.
      expect(res.status).not.toBe(204);
      expect(res.status).not.toBe(401);
      await res.body?.cancel();
    } finally {
      abort.abort();
      await server.finished;
      database.driver.close();
    }
  });

  it("audit listener serves ONLY the webhook: tRPC paths are 404", async () => {
    const abort = new AbortController();
    const listening = Promise.withResolvers<number>();
    const server = startMinioEventServer({
      port: 0,
      hostname: "127.0.0.1", // Tests use loopback; the deploy default is 0.0.0.0.
      sink: { token: "sekret", onEvent: () => {} },
      signal: abort.signal,
      onListen: ({ port }) => listening.resolve(port),
    });
    const port = await listening.promise;

    try {
      const trpc = await fetch(`http://127.0.0.1:${port}/trpc/friends.list`);
      expect(trpc.status).toBe(404);
      await trpc.body?.cancel();

      const health = await fetch(`http://127.0.0.1:${port}/health`);
      expect(health.status).toBe(200);
      await health.body?.cancel();
    } finally {
      abort.abort();
      await server.finished;
    }
  });

  it("audit webhook: 401 without the token, 204 + forwards with it", async () => {
    const received: unknown[] = [];
    const abort = new AbortController();
    const listening = Promise.withResolvers<number>();
    const server = startMinioEventServer({
      port: 0,
      hostname: "127.0.0.1",
      sink: {
        token: "sekret",
        onEvent: (raw) => {
          received.push(raw);
        },
      },
      signal: abort.signal,
      onListen: ({ port }) => listening.resolve(port),
    });
    const port = await listening.promise;

    try {
      const noAuth = await fetch(
        `http://127.0.0.1:${port}/internal/minio-events`,
        {
          method: "POST",
          body: "{}",
        },
      );
      expect(noAuth.status).toBe(401);
      await noAuth.body?.cancel();

      const wrongToken = await fetch(
        `http://127.0.0.1:${port}/internal/minio-events`,
        {
          method: "POST",
          headers: { authorization: "Bearer wrong" },
          body: "{}",
        },
      );
      expect(wrongToken.status).toBe(401);
      await wrongToken.body?.cancel();

      // Bodies over 1 MiB are rejected up front with a 413 and never reach onEvent.
      const huge = await fetch(
        `http://127.0.0.1:${port}/internal/minio-events`,
        {
          method: "POST",
          headers: { authorization: "Bearer sekret" },
          body: `{"pad":"${"x".repeat(1024 * 1024 + 1)}"}`,
        },
      );
      expect(huge.status).toBe(413);
      await huge.body?.cancel();
      expect(received.length).toBe(0);

      // With no Content-Length, the size check can't see the body, so LimitedBytesTransformStream
      // must trip the cap mid-upload; the client may see a 413 or a reset, but the event is never ingested.
      const chunk = new TextEncoder().encode("x".repeat(64 * 1024));
      const chunkedOutcome = await fetch(
        `http://127.0.0.1:${port}/internal/minio-events`,
        {
          method: "POST",
          headers: { authorization: "Bearer sekret" },
          body: new ReadableStream<Uint8Array>({
            start(controller) {
              // 17 chunks of 64 KiB total 1088 KiB, more than the 1 MiB cap.
              Array.from({ length: 17 }).forEach(() =>
                controller.enqueue(chunk)
              );
              controller.close();
            },
          }),
        },
      ).then(
        async (res) => {
          await res.body?.cancel();
          return res.status;
        },
        () => "reset" as const,
      );
      expect([413, "reset"]).toContain(chunkedOutcome);
      expect(received.length).toBe(0);

      const badJson = await fetch(
        `http://127.0.0.1:${port}/internal/minio-events`,
        {
          method: "POST",
          headers: { authorization: "Bearer sekret" },
          body: "not json",
        },
      );
      expect(badJson.status).toBe(400);
      await badJson.body?.cancel();

      const ok = await fetch(`http://127.0.0.1:${port}/internal/minio-events`, {
        method: "POST",
        headers: { authorization: "Bearer sekret" },
        body: JSON.stringify({ api: { name: "PutObject", bucket: "alice" } }),
      });
      expect(ok.status).toBe(204);
      await ok.body?.cancel();
      expect(received.length).toBe(1);
    } finally {
      abort.abort();
      await server.finished;
    }
  });

  it("staticDir: serves built assets and falls back to index.html", async () => {
    const database = createTestDatabase();
    const context = await buildContext(database, testEnv(), noopLogger());
    // The temp asset dir lives inside the repo, not /tmp, and is removed in the finally block.
    const staticDir = await Deno.makeTempDir({ dir: ".", prefix: "static-" });
    await Deno.writeTextFile(`${staticDir}/index.html`, "<!doctype html>app");
    await Deno.writeTextFile(`${staticDir}/app.js`, "console.log(1)");
    const abort = new AbortController();
    const listening = Promise.withResolvers<number>();
    const server = startServer({
      port: 0,
      context,
      staticDir,
      signal: abort.signal,
      onListen: ({ port }) => listening.resolve(port),
    });
    const port = await listening.promise;

    try {
      const js = await fetch(`http://127.0.0.1:${port}/app.js`);
      expect(js.status).toBe(200);
      expect(await js.text()).toBe("console.log(1)");

      const deep = await fetch(`http://127.0.0.1:${port}/friends/alice`);
      expect(deep.status).toBe(200);
      expect(await deep.text()).toBe("<!doctype html>app");

      const trpc = await fetch(`http://127.0.0.1:${port}/trpc/friends.list`);
      expect(trpc.status).toBe(200);
      await trpc.body?.cancel();
    } finally {
      abort.abort();
      await server.finished;
      database.driver.close();
      await Deno.remove(staticDir, { recursive: true });
    }
  });
});

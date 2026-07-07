import { describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { startServer } from "./server.ts";
import { buildContext } from "./app.ts";
import { createTestDatabase } from "./test-helpers/testDb.ts";
import { noopLogger, testEnv } from "./test-helpers/mocks.ts";

describe("startServer (HTTP)", () => {
  it("serves /health and the tRPC router on loopback", async () => {
    const database = createTestDatabase();
    const context = buildContext(database, testEnv(), noopLogger());
    const abort = new AbortController();
    const listening = Promise.withResolvers<number>();
    const server = startServer({
      port: 0, // ephemeral
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

  it("audit webhook: 401 without the token, 204 + forwards with it", async () => {
    const database = createTestDatabase();
    const context = buildContext(database, testEnv(), noopLogger());
    const received: unknown[] = [];
    const abort = new AbortController();
    const listening = Promise.withResolvers<number>();
    const server = startServer({
      port: 0,
      context,
      audit: {
        token: "sekret",
        onEvent: (raw) => {
          received.push(raw);
          return Promise.resolve();
        },
      },
      signal: abort.signal,
      onListen: ({ port }) => listening.resolve(port),
    });
    const port = await listening.promise;

    try {
      const noAuth = await fetch(`http://127.0.0.1:${port}/internal/audit`, {
        method: "POST",
        body: "{}",
      });
      expect(noAuth.status).toBe(401);
      await noAuth.body?.cancel();

      const wrongToken = await fetch(
        `http://127.0.0.1:${port}/internal/audit`,
        {
          method: "POST",
          headers: { authorization: "Bearer wrong" },
          body: "{}",
        },
      );
      expect(wrongToken.status).toBe(401);
      await wrongToken.body?.cancel();

      // >1 MiB body rejected up front (413) — never reaches onEvent.
      const huge = await fetch(`http://127.0.0.1:${port}/internal/audit`, {
        method: "POST",
        headers: { authorization: "Bearer sekret" },
        body: `{"pad":"${"x".repeat(1024 * 1024 + 1)}"}`,
      });
      expect(huge.status).toBe(413);
      await huge.body?.cancel();
      expect(received.length).toBe(0);

      // Same cap with NO Content-Length (chunked stream): the declared-size
      // check can't see it, so the LimitedBytesTransformStream must trip.
      // The server aborts the read mid-upload, so the client races between
      // receiving the 413 and a connection reset — BOTH prove the cap fired;
      // the invariant is that the event is never ingested.
      const chunk = new TextEncoder().encode("x".repeat(64 * 1024));
      const chunkedOutcome = await fetch(
        `http://127.0.0.1:${port}/internal/audit`,
        {
          method: "POST",
          headers: { authorization: "Bearer sekret" },
          body: new ReadableStream<Uint8Array>({
            start(controller) {
              // 17 × 64 KiB = 1088 KiB > 1 MiB
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

      const badJson = await fetch(`http://127.0.0.1:${port}/internal/audit`, {
        method: "POST",
        headers: { authorization: "Bearer sekret" },
        body: "not json",
      });
      expect(badJson.status).toBe(400);
      await badJson.body?.cancel();

      const ok = await fetch(`http://127.0.0.1:${port}/internal/audit`, {
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
      database.driver.close();
    }
  });

  it("staticDir: serves built assets and falls back to index.html", async () => {
    const database = createTestDatabase();
    const context = buildContext(database, testEnv(), noopLogger());
    // Temp asset dir inside the repo (never /tmp); cleaned up in finally.
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
      // Real asset is served as-is.
      const js = await fetch(`http://127.0.0.1:${port}/app.js`);
      expect(js.status).toBe(200);
      expect(await js.text()).toBe("console.log(1)");

      // Unknown path (a client-side route) falls back to index.html.
      const deep = await fetch(`http://127.0.0.1:${port}/friends/alice`);
      expect(deep.status).toBe(200);
      expect(await deep.text()).toBe("<!doctype html>app");

      // API routes still win over static.
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

import { describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { MinioEventForwarder } from "./MinioEventForwarder.ts";
import { subscription } from "./MinioEventSubscription.ts";
import { noopLogger, recordingLogger } from "../test-helpers/mocks.ts";

describe("MinioEventForwarder", () => {
  const URL = "https://sink.example/hook";
  const RAW = { api: { name: "PutObject", bucket: "alice" }, accessKey: "K" };

  /** A fetch stub: records each call, responds per attempt number (1-based). */
  const attemptFetch = (responder: (attempt: number) => Response) => {
    const calls: { url: string; init: RequestInit }[] = [];
    const fn = ((url: string | URL, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      return Promise.resolve(responder(calls.length));
    }) as unknown as typeof fetch;
    return { fn, calls };
  };

  const headersOf = (init: RequestInit): Record<string, string> =>
    (init.headers ?? {}) as Record<string, string>;

  async function* one(raw: unknown) {
    yield raw;
  }

  /** A raw-event subscription of exactly `RAW`, tearing down on `signal`. */
  const rawSub = (signal: AbortSignal) => subscription(one(RAW), signal);

  it("forwards the raw payload byte-identical, one JSON POST per event", async () => {
    // Non-empty body so the response-drain path (res.body.cancel) runs.
    const { fn, calls } = attemptFetch(() =>
      new Response("ok", { status: 200 })
    );
    const fwd = new MinioEventForwarder(
      rawSub(new AbortController().signal),
      { url: URL },
      noopLogger(),
      fn,
    );

    await fwd.done;

    expect(calls.length).toBe(1);
    expect(calls[0].url).toBe(URL);
    expect(calls[0].init.method).toBe("POST");
    expect(calls[0].init.body).toBe(JSON.stringify(RAW));
    expect(headersOf(calls[0].init)["content-type"]).toBe("application/json");
    expect(headersOf(calls[0].init).authorization).toBeUndefined();
  });

  it("sends the configured Authorization header verbatim", async () => {
    const { fn, calls } = attemptFetch(() =>
      new Response(null, { status: 200 })
    );
    const fwd = new MinioEventForwarder(
      rawSub(new AbortController().signal),
      { url: URL, authorization: "Bearer tok" },
      noopLogger(),
      fn,
    );

    await fwd.done;
    expect(headersOf(calls[0].init).authorization).toBe("Bearer tok");
  });

  it("retries up to maxRetry, then logs once (rate-limited)", async () => {
    const { fn, calls } = attemptFetch(() =>
      new Response(null, { status: 500 })
    );
    const { logger, warns } = recordingLogger();
    const fwd = new MinioEventForwarder(
      rawSub(new AbortController().signal),
      { url: URL, maxRetry: 3, retryIntervalMs: 0 },
      logger,
      fn,
    );

    await fwd.done;
    expect(calls.length).toBe(3);
    expect(warns.length).toBe(1);
  });

  it("logs when the endpoint is unreachable (fetch throws)", async () => {
    const { logger, warns } = recordingLogger();
    let calls = 0;
    const fn = (() => {
      calls++;
      return Promise.reject(new Error("ECONNREFUSED"));
    }) as unknown as typeof fetch;
    const fwd = new MinioEventForwarder(
      rawSub(new AbortController().signal),
      { url: URL, maxRetry: 2, retryIntervalMs: 0 },
      logger,
      fn,
    );

    await fwd.done;
    expect(calls).toBe(2);
    expect(warns.length).toBe(1);
  });

  it("succeeds after a transient failure without logging", async () => {
    const { fn, calls } = attemptFetch((n) =>
      new Response(null, { status: n < 2 ? 500 : 200 })
    );
    const { logger, warns } = recordingLogger();
    const fwd = new MinioEventForwarder(
      rawSub(new AbortController().signal),
      { url: URL, maxRetry: 3, retryIntervalMs: 0 },
      logger,
      fn,
    );

    await fwd.done;
    expect(calls.length).toBe(2);
    expect(warns.length).toBe(0);
  });

  it("stops retrying once the subscription aborts (shutdown)", async () => {
    const ac = new AbortController();
    const { fn, calls } = attemptFetch(() => {
      ac.abort(); // shutdown arrives during the first attempt
      return new Response(null, { status: 500 });
    });
    const fwd = new MinioEventForwarder(
      rawSub(ac.signal),
      { url: URL, maxRetry: 5, retryIntervalMs: 1000 },
      noopLogger(),
      fn,
    );

    await fwd.done;
    expect(calls.length).toBe(1); // aborted before the second attempt
  });

  it("a mid-stream error stops the consumer, logged — done never rejects", async () => {
    const errors: string[] = [];
    const logger = {
      ...noopLogger(),
      error: (m: string) => void errors.push(m),
    };
    const { fn } = attemptFetch(() => new Response(null, { status: 200 }));

    const boom: AsyncIterable<unknown> = {
      [Symbol.asyncIterator]: () => ({
        next: () => Promise.reject(new Error("stream broke")),
      }),
    };

    await new MinioEventForwarder(
      subscription(boom, new AbortController().signal),
      { url: URL },
      logger,
      fn,
    ).done;
    expect(errors.some((m) => m.includes("forwarder stopped"))).toBe(true);
  });
});

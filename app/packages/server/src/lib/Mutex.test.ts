import { describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { Mutex } from "./Mutex.ts";

describe("Mutex", () => {
  it("serializes overlapping run() calls in FIFO order", async () => {
    const mutex = new Mutex();
    const order: string[] = [];
    const slow = mutex.run(async () => {
      order.push("slow:start");
      await new Promise((r) => setTimeout(r, 10));
      order.push("slow:end");
    });
    const fast = mutex.run(() => {
      order.push("fast");
      return Promise.resolve();
    });
    await Promise.all([slow, fast]);
    expect(order).toEqual(["slow:start", "slow:end", "fast"]);
  });

  it("releases the lock when a locked op throws", async () => {
    const mutex = new Mutex();
    await expect(mutex.run(() => Promise.reject(new Error("boom"))))
      .rejects.toThrow("boom");
    // A throw must not wedge the lock.
    expect(await mutex.run(() => Promise.resolve("next"))).toBe("next");
  });

  it("runStream holds the lock across the WHOLE stream, then releases", async () => {
    const mutex = new Mutex();
    const order: string[] = [];
    async function* steps(): AsyncGenerator<string, void> {
      order.push("stream:a");
      yield "a";
      order.push("stream:b");
      yield "b";
    }
    // The lock is acquired on the FIRST next() (generator bodies are lazy),
    // so start the stream before racing the competing op against it.
    const it1 = mutex.runStream(steps)[Symbol.asyncIterator]();
    await it1.next();
    const other = mutex.run(() => {
      order.push("other");
      return Promise.resolve();
    });
    await it1.next();
    await it1.next(); // stream done → lock released
    await other;
    // `other` queued behind the stream and only ran after it finished.
    expect(order).toEqual(["stream:a", "stream:b", "other"]);
  });

  it("releases when a stream is abandoned early (consumer return)", async () => {
    const mutex = new Mutex();
    async function* steps(): AsyncGenerator<number, void> {
      yield 1;
      yield 2;
      yield 3;
    }
    const stream = mutex.runStream(steps);
    const it1 = stream[Symbol.asyncIterator]();
    await it1.next();
    await it1.return?.(undefined); // abandon mid-stream
    expect(await mutex.run(() => Promise.resolve("free"))).toBe("free");
  });
});

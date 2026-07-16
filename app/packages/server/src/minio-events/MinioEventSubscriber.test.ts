import { describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { MinioEventSubscriber } from "./MinioEventSubscriber.ts";
import { noopLogger, recordingLogger } from "../test-helpers/mocks.ts";

describe("MinioEventSubscriber", () => {
  it("drains buffered events in FIFO order", async () => {
    const sub = new MinioEventSubscriber("s", 10, noopLogger());
    sub.enqueue("a");
    sub.enqueue("b");
    const it = sub.stream()[Symbol.asyncIterator]();
    expect((await it.next()).value).toBe("a");
    expect((await it.next()).value).toBe("b");
  });

  it("drops the OLDEST event on overflow and counts the drops", async () => {
    const sub = new MinioEventSubscriber("s", 2, noopLogger());
    sub.enqueue("1");
    sub.enqueue("2");
    sub.enqueue("3"); // capacity 2 → "1" is dropped
    expect(sub.drops).toBe(1);
    const it = sub.stream()[Symbol.asyncIterator]();
    expect((await it.next()).value).toBe("2");
    expect((await it.next()).value).toBe("3");
  });

  it("drains buffered events on close before ending", async () => {
    const sub = new MinioEventSubscriber("s", 10, noopLogger());
    sub.enqueue("a");
    sub.enqueue("b");
    sub.close();
    const it = sub.stream()[Symbol.asyncIterator]();
    expect((await it.next()).value).toBe("a");
    expect((await it.next()).value).toBe("b");
    expect((await it.next()).done).toBe(true);
  });

  it("warns on overflow, rate-limited to the first drop", () => {
    const { logger, warns } = recordingLogger();
    const sub = new MinioEventSubscriber("s", 1, logger);
    sub.enqueue("1");
    sub.enqueue("2"); // drops "1" → drops=1 → warns
    sub.enqueue("3"); // drops "2" → drops=2 → no warn (not 1st, not every-Nth)
    expect(sub.drops).toBe(2);
    expect(warns.length).toBe(1);
  });

  it("parks when empty and resumes on the next push", async () => {
    const sub = new MinioEventSubscriber("s", 10, noopLogger());
    const it = sub.stream()[Symbol.asyncIterator]();
    const pending = it.next(); // queue empty → parks
    sub.enqueue("late");
    expect((await pending).value).toBe("late");
  });

  it("ends the generator on close", async () => {
    const sub = new MinioEventSubscriber("s", 10, noopLogger());
    const it = sub.stream()[Symbol.asyncIterator]();
    const pending = it.next(); // parked
    sub.close();
    expect((await pending).done).toBe(true);
  });
});

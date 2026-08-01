import { describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { MinioEventBus } from "./MinioEventBus.ts";
import { noopLogger } from "../test-helpers/mocks.ts";

describe("MinioEventBus", () => {
  // The bus owns the shutdown signal; subscribe() takes no signal.
  const build = (capacity?: number) => {
    const abort = new AbortController();
    const bus = capacity === undefined
      ? new MinioEventBus(noopLogger(), abort)
      : new MinioEventBus(noopLogger(), abort, capacity);
    return { bus, abort };
  };

  it("fans one event out to every subscriber", async () => {
    const { bus } = build();
    const a = bus.subscribe("a").events[Symbol.asyncIterator]();
    const b = bus.subscribe("b").events[Symbol.asyncIterator]();
    expect(bus.size).toBe(2);

    bus.publish({ n: 1 });
    expect((await a.next()).value).toEqual({ n: 1 });
    expect((await b.next()).value).toEqual({ n: 1 });
  });

  it("gives each subscriber an independent queue (no cross-consumption)", async () => {
    const { bus } = build();
    const a = bus.subscribe("a").events[Symbol.asyncIterator]();
    const b = bus.subscribe("b").events[Symbol.asyncIterator]();

    bus.publish("1");
    bus.publish("2");
    expect((await a.next()).value).toBe("1");
    expect((await a.next()).value).toBe("2");
    expect((await b.next()).value).toBe("1");
    expect((await b.next()).value).toBe("2");
  });

  it("a stalled subscriber never blocks publish or starves the others", async () => {
    const { bus } = build(2);
    // "stalled" subscribes but never consumes, so its bounded queue overflows.
    bus.subscribe("stalled");
    const healthy = bus.subscribe("healthy").events[Symbol.asyncIterator]();

    // Publishing past capacity must return synchronously each time (a throw or
    // hang here would fail the test) despite the stalled subscriber.
    bus.publish("1");
    bus.publish("2");
    bus.publish("3");

    expect((await healthy.next()).value).toBe("2");
    expect((await healthy.next()).value).toBe("3");
  });

  it("abort removes every subscriber and ends its stream", async () => {
    const { bus, abort } = build();
    const a = bus.subscribe("a").events[Symbol.asyncIterator]();
    expect(bus.size).toBe(1);

    const pending = a.next(); // Parked because nothing has been published yet.
    abort.abort();
    expect(bus.size).toBe(0);
    expect((await pending).done).toBe(true);
  });

  it("subscribing after the signal already aborted is inert", () => {
    const abort = new AbortController();
    abort.abort();
    const bus = new MinioEventBus(noopLogger(), abort);
    bus.subscribe("late");
    expect(bus.size).toBe(0);
  });
});

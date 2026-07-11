import { describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { AuditBus } from "./AuditBus.ts";
import { noopLogger } from "../test-helpers/mocks.ts";

describe("AuditBus", () => {
  it("fans one event out to every subscriber", async () => {
    const bus = new AuditBus(noopLogger());
    const ac = new AbortController();
    const a = bus.subscribe("a", ac.signal)[Symbol.asyncIterator]();
    const b = bus.subscribe("b", ac.signal)[Symbol.asyncIterator]();
    expect(bus.size).toBe(2);

    bus.publish({ n: 1 });
    expect((await a.next()).value).toEqual({ n: 1 });
    expect((await b.next()).value).toEqual({ n: 1 });
  });

  it("gives each subscriber an independent queue (no cross-consumption)", async () => {
    const bus = new AuditBus(noopLogger());
    const ac = new AbortController();
    const a = bus.subscribe("a", ac.signal)[Symbol.asyncIterator]();
    const b = bus.subscribe("b", ac.signal)[Symbol.asyncIterator]();

    bus.publish("1");
    bus.publish("2");
    // Draining A does not consume B's copies.
    expect((await a.next()).value).toBe("1");
    expect((await a.next()).value).toBe("2");
    expect((await b.next()).value).toBe("1");
    expect((await b.next()).value).toBe("2");
  });

  it("a stalled subscriber never blocks publish or starves the others", async () => {
    const bus = new AuditBus(noopLogger(), 2);
    const ac = new AbortController();
    // "stalled" subscribes but never consumes → its bounded queue overflows.
    bus.subscribe("stalled", ac.signal);
    const healthy = bus.subscribe("healthy", ac.signal)[Symbol.asyncIterator]();

    // Publishing past capacity must return synchronously each time (a throw or
    // hang here would fail the test) despite the stalled subscriber.
    bus.publish("1");
    bus.publish("2");
    bus.publish("3");

    // The healthy subscriber still drains its own queue independently.
    expect((await healthy.next()).value).toBe("2");
    expect((await healthy.next()).value).toBe("3");
  });

  it("abort removes the subscriber and ends its stream", async () => {
    const bus = new AuditBus(noopLogger());
    const ac = new AbortController();
    const a = bus.subscribe("a", ac.signal)[Symbol.asyncIterator]();
    expect(bus.size).toBe(1);

    const pending = a.next(); // parked (nothing published)
    ac.abort();
    expect(bus.size).toBe(0);
    expect((await pending).done).toBe(true);
  });

  it("subscribing with an already-aborted signal is inert", () => {
    const bus = new AuditBus(noopLogger());
    const ac = new AbortController();
    ac.abort();
    bus.subscribe("late", ac.signal);
    expect(bus.size).toBe(0);
  });
});

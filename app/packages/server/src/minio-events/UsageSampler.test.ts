import { describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { FakeTime } from "@std/testing/time";
import type { UsageSampleTarget } from "../db/FriendQueries.ts";
import {
  mockMcClient,
  mockMcFactory,
  noopLogger,
} from "../test-helpers/mocks.ts";
import { UsageSampler, type UsageStore } from "./UsageSampler.ts";
import {
  type MinioEventSubscription,
  subscription,
} from "./MinioEventSubscription.ts";
import type { FriendEvent } from "./resolveFriend.ts";

describe("UsageSampler", () => {
  const TARGETS: UsageSampleTarget[] = [
    { friendId: 1, bucket: "alice", alias: "p0rt1on-alice", minioPort: 9100 },
    { friendId: 2, bucket: "bob", alias: "p0rt1on-bob", minioPort: 9101 },
  ];

  function fakeStore(targets: UsageSampleTarget[]) {
    const inserted: number[] = [];
    const store: UsageStore = {
      usageSampleTargets: () => Promise.resolve(targets),
      insertUsage: (friendId) => {
        inserted.push(friendId);
        return Promise.resolve();
      },
    };
    return { store, inserted };
  }

  // Empty stream for tests that drive sampleAll/noteActivity directly.
  const emptyStream = (): MinioEventSubscription<FriendEvent> =>
    subscription(
      (async function* (): AsyncGenerator<FriendEvent> {})(),
      new AbortController().signal,
    );

  const buildSampler = (
    store: UsageStore,
    duCalls: string[] = [],
    du = () => Promise.resolve({ bytesUsed: 42, objectCount: 3 }),
    events: MinioEventSubscription<FriendEvent> = emptyStream(),
  ) =>
    new UsageSampler(
      events,
      store,
      {
        ...mockMcFactory(mockMcClient([])),
        forInstance: (target) => ({
          ...mockMcClient([]),
          du: (bucket: string) => {
            duCalls.push(`${target.alias}/${bucket}`);
            return du();
          },
        }),
      },
      noopLogger(),
      undefined,
      { attempts: 1, delayMs: 1 }, // No retries, so failure tests stay instant.
    );

  it("sampleAll measures every active friend and records a sample", async () => {
    const { store, inserted } = fakeStore(TARGETS);
    const duCalls: string[] = [];

    expect(await buildSampler(store, duCalls).sampleAll()).toBe(2);
    expect(duCalls).toEqual(["p0rt1on-alice/alice", "p0rt1on-bob/bob"]);
    expect(inserted).toEqual([1, 2]);
  });

  it("sampleAll tolerates one friend's du failing (best-effort)", async () => {
    const { store, inserted } = fakeStore(TARGETS);
    const sampler = new UsageSampler(
      emptyStream(),
      store,
      {
        ...mockMcFactory(mockMcClient([])),
        forInstance: (target) => ({
          ...mockMcClient([]),
          du: () =>
            target.alias === "p0rt1on-alice"
              ? Promise.reject(new Error("instance down"))
              : Promise.resolve({ bytesUsed: 1, objectCount: 1 }),
        }),
      },
      noopLogger(),
      undefined,
      { attempts: 1, delayMs: 1 },
    );

    expect(await sampler.sampleAll()).toBe(1);
    expect(inserted).toEqual([2]);
  });

  it("noteActivity debounces: one sample fires after the LAST event of a burst", async () => {
    using time = new FakeTime();
    const { store, inserted } = fakeStore(TARGETS);
    const duCalls: string[] = [];
    const sampler = buildSampler(store, duCalls);

    // Events arrive 10s apart during the burst; each one re-arms the 30s debounce timer.
    sampler.noteActivity(2);
    await time.tickAsync(10_000);
    sampler.noteActivity(2);
    await time.tickAsync(10_000);
    sampler.noteActivity(2);
    expect(duCalls).toEqual([]); // No sample fires yet because the burst is still active.

    await time.tickAsync(30_000); // 30 seconds of quiet triggers exactly one sample.
    // tickAsync fires the timer but does not flush the promise chain the
    // callback starts, so drain microtasks before asserting.
    await time.runMicrotasks();
    expect(duCalls).toEqual(["p0rt1on-bob/bob"]);
    expect(inserted).toEqual([2]);
  });

  it("noteActivity for a friend no longer active is a silent no-op", async () => {
    using time = new FakeTime();
    const { store, inserted } = fakeStore([TARGETS[0]]); // Friend 2 (bob) is not active here.
    const sampler = buildSampler(store);

    sampler.noteActivity(2);
    await time.tickAsync(30_000);
    await time.runMicrotasks();
    expect(inserted).toEqual([]);
  });

  it("run debounces a sample per friend event on the stream", async () => {
    using time = new FakeTime();
    const { store, inserted } = fakeStore(TARGETS);
    const duCalls: string[] = [];

    async function* events(): AsyncGenerator<FriendEvent> {
      yield {
        event: {
          bucket: "alice",
          op: "PutObject",
          statusCode: 200,
          rx: 0,
          tx: 0,
          time: "T",
          accessKey: "KEY1",
        },
        friendId: 1,
      };
    }

    // Constructing starts the stream trigger; `done` resolves when it ends.
    const sampler = buildSampler(
      store,
      duCalls,
      undefined,
      subscription(events(), new AbortController().signal),
    );
    await sampler.done;

    await time.tickAsync(30_000);
    await time.runMicrotasks();
    expect(duCalls).toEqual(["p0rt1on-alice/alice"]);
    expect(inserted).toEqual([1]);
  });

  it("a mid-stream error stops the consumer, logged — done never rejects", async () => {
    const errors: string[] = [];
    const logger = {
      ...noopLogger(),
      error: (m: string) => void errors.push(m),
    };
    const { store } = fakeStore(TARGETS);

    const boom: AsyncIterable<FriendEvent> = {
      [Symbol.asyncIterator]: () => ({
        next: () => Promise.reject(new Error("stream broke")),
      }),
    };

    await new UsageSampler(
      subscription(boom, new AbortController().signal),
      store,
      mockMcFactory(mockMcClient([])),
      logger,
    ).done;
    expect(errors.some((m) => m.includes("sampler stopped"))).toBe(true);
  });

  it("dispose cancels pending debounce timers", async () => {
    using time = new FakeTime();
    const { store, inserted } = fakeStore(TARGETS);
    const sampler = buildSampler(store);

    sampler.noteActivity(1);
    sampler.dispose();
    await time.tickAsync(60_000);
    expect(inserted).toEqual([]);
  });
});

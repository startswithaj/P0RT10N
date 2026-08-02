import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SubscriptionHandler } from "./types.ts";
import { subscriptionHandlers } from "./subscriptions.ts";
import { mutationHandlers } from "./mutations.ts";
import { getDemoState, resetDemoState } from "../state.ts";
import { PROVISION_STEPS } from "@p0rt1on/shared/steps";

describe("demo subscriptions", () => {
  const mutate = (path: string, input: unknown): unknown => {
    const fns = mutationHandlers as unknown as Record<
      string,
      (input: unknown) => unknown
    >;
    return fns[path](input);
  };

  const startAdd = (name: string): string =>
    (mutate("friends.addStart", {
      name,
      quotaBytes: 50_000_000_000,
      retentionDays: 30,
      isolationMode: "dedicated",
      enrollment: { mode: "authKey" },
    }) as { jobId: string }).jobId;

  const collect = (path: string, input: unknown) => {
    const handlers = subscriptionHandlers as unknown as Record<
      string,
      SubscriptionHandler
    >;
    const events: unknown[] = [];
    const state = { completed: false };
    const teardown = handlers[path](input, {
      data: (v) => events.push(v),
      error: (e) => events.push({ error: e }),
      complete: () => {
        state.completed = true;
      },
    });
    return { events, teardown, done: () => state.completed };
  };

  beforeEach(() => {
    sessionStorage.clear();
    resetDemoState();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  describe("jobs.progress simulator", () => {
    it("emits every provision step, then done, and commits the friend", () => {
      const jobId = startAdd("eve");
      const { events, done } = collect("jobs.progress", { jobId });
      vi.runAllTimers();
      const steps = events.filter((e) =>
        (e as { type: string }).type === "step"
      );
      expect(steps).toHaveLength(PROVISION_STEPS.length);
      expect((events.at(-1) as { type: string }).type).toBe("done");
      expect(done()).toBe(true);
      expect(getDemoState().friends.find((f) => f.name === "eve")?.status).toBe(
        "active",
      );
    });

    it("fails on the smoke step for `fail-smoke` and does not commit", () => {
      const jobId = startAdd("fail-smoke");
      const { events } = collect("jobs.progress", { jobId });
      vi.runAllTimers();
      const last = events.at(-1) as { type: string; step: string };
      expect(last.type).toBe("error");
      expect(last.step).toBe("smoke");
      expect(getDemoState().friends.find((f) => f.name === "fail-smoke"))
        .toBeUndefined();
    });

    it("is idempotent — a replayed run does not double-add", () => {
      const jobId = startAdd("eve");
      collect("jobs.progress", { jobId });
      vi.runAllTimers();
      collect("jobs.progress", { jobId });
      vi.runAllTimers();
      expect(getDemoState().friends.filter((f) => f.name === "eve"))
        .toHaveLength(1);
    });

    it("emits an error DATA event for an unknown job id", () => {
      const { events } = collect("jobs.progress", { jobId: "nope" });
      expect((events[0] as { type: string }).type).toBe("error");
    });

    it("offboard job removes the friend on completion", () => {
      const { jobId } = mutate("friends.offboardStart", { friendId: 1 }) as {
        jobId: string;
      };
      collect("jobs.progress", { jobId });
      vi.runAllTimers();
      expect(getDemoState().friends.find((f) => f.id === 1)).toBeUndefined();
    });
  });
});

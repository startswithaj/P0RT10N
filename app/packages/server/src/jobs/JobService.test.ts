import { describe, it } from "@std/testing/bdd";
import { FakeTime } from "@std/testing/time";
import { expect } from "@std/expect";
import type { FriendBundle } from "@p0rt1on/shared/domain";
import type { ProgressEvent } from "../lib/progress.ts";
import { noopLogger } from "../test-helpers/mocks.ts";
import { JobService } from "./JobService.ts";

describe("JobService", () => {
  const bundle: FriendBundle = {
    name: "alice",
    s3Endpoint: "https://alice.ts.net",
    bucket: "backup",
    s3AccessKeyId: "AK",
    s3SecretKey: "SK",
    kopiaQuickstart: "kopia ...",
  };

  /** Generator that yields the given events, then optionally throws. */
  async function* fakeGen<R>(
    events: ProgressEvent<string, R>[],
    fail?: Error,
  ): AsyncGenerator<ProgressEvent<string, R>> {
    yield* events;
    if (fail) throw fail;
  }

  it("records steps and done; progress replays them", async () => {
    const svc = new JobService(noopLogger());
    const id = svc.start(
      "offboard",
      fakeGen<void>([
        { type: "step", step: "storage" },
        { type: "step", step: "nodes" },
        { type: "done", result: undefined },
      ]),
    );
    expect(await Array.fromAsync(svc.progress(id))).toEqual([
      { type: "step", step: "storage" },
      { type: "step", step: "nodes" },
      { type: "done", bundleReady: false },
    ]);
    // A second observer (reconnect) replays identically — no re-run.
    expect(await Array.fromAsync(svc.progress(id))).toHaveLength(3);
  });

  it("turns a generator throw into an error EVENT naming the failing step", async () => {
    const svc = new JobService(noopLogger());
    const id = svc.start(
      "offboard",
      fakeGen<void>(
        [{ type: "step", step: "storage" }],
        new Error("mc rb failed"),
      ),
    );
    expect(await Array.fromAsync(svc.progress(id))).toEqual([
      { type: "step", step: "storage" },
      { type: "error", message: "mc rb failed", step: "storage" },
    ]);
  });

  it("passes advisory text (manual ACL cleanup) on the done event", async () => {
    const svc = new JobService(noopLogger());
    const id = svc.start(
      "offboard",
      fakeGen<{ manualAclCleanup?: string }>([
        { type: "done", result: { manualAclCleanup: "remove tag:x" } },
      ]),
      undefined,
      (r) => r.manualAclCleanup,
    );
    expect(await Array.fromAsync(svc.progress(id))).toEqual([
      { type: "done", bundleReady: false, manualAclCleanup: "remove tag:x" },
    ]);
  });

  it("captures the bundle for exactly one claim, then wipes it", async () => {
    const svc = new JobService(noopLogger());
    const id = svc.start(
      "add",
      fakeGen<FriendBundle>([{ type: "done", result: bundle }]),
      (r) => r,
    );
    const events = await Array.fromAsync(svc.progress(id));
    // The stream signals readiness but never carries the secrets.
    expect(events).toEqual([{ type: "done", bundleReady: true }]);
    expect(svc.claimBundle(id)).toEqual(bundle);
    expect(() => svc.claimBundle(id)).toThrow("already claimed");
  });

  it("yields a renderable error event for an unknown job id", async () => {
    const svc = new JobService(noopLogger());
    const events = await Array.fromAsync(svc.progress("nope"));
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("error");
  });

  it("streams live events to an observer attached before the job finishes", async () => {
    const svc = new JobService(noopLogger());
    // A generator gated on a promise so the observer attaches mid-run.
    const gate = Promise.withResolvers<void>();

    async function* gated(): AsyncGenerator<ProgressEvent<string, void>> {
      yield { type: "step", step: "storage" };
      await gate.promise;
      yield { type: "done", result: undefined };
    }

    const id = svc.start("offboard", gated());
    const drained = Array.fromAsync(svc.progress(id));
    gate.resolve();
    expect(await drained).toEqual([
      { type: "step", step: "storage" },
      { type: "done", bundleReady: false },
    ]);
  });

  it("prunes finished jobs after the 15-minute TTL", async () => {
    const time = new FakeTime();
    try {
      const svc = new JobService(noopLogger());
      const id = svc.start(
        "offboard",
        fakeGen<void>([{ type: "done", result: undefined }]),
      );
      await Array.fromAsync(svc.progress(id)); // job finished at t=0
      time.tick(16 * 60 * 1000);
      // Next start() triggers the prune (no timers by design).
      svc.start(
        "offboard",
        fakeGen<void>([{ type: "done", result: undefined }]),
      );
      expect(await Array.fromAsync(svc.progress(id))).toEqual([{
        type: "error",
        message: "job not found (expired or manager restarted)",
        step: null,
      }]);
    } finally {
      time.restore();
    }
  });

  it("claimBundle throws for unknown ids and for jobs that produced no bundle", async () => {
    const svc = new JobService(noopLogger());
    expect(() => svc.claimBundle("nope")).toThrow("job not found");
    const id = svc.start(
      "offboard",
      fakeGen<void>([{ type: "done", result: undefined }]),
    );
    await Array.fromAsync(svc.progress(id));
    expect(() => svc.claimBundle(id)).toThrow("none produced");
  });
});

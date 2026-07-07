import { describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import type { FriendBundle } from "@p0rt1on/shared/domain";
import type { ProgressEvent } from "../lib/progress.ts";
import { noopLogger } from "../test-helpers/mocks.ts";
import { JobService } from "./JobService.ts";

describe("JobService", () => {
  const bundle: FriendBundle = {
    name: "alice",
    s3Endpoint: "https://alice.ts.net",
    region: "us-east-1",
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
});

import type { DemoJob } from "../state.ts";
import type { SubscriptionHandler, SubscriptionHandlers } from "./types.ts";
import { getDemoState, updateDemoState } from "../state.ts";
import { OFFBOARD_STEPS, PROVISION_STEPS } from "@p0rt1on/shared/steps";
import type { JobProgressEvent } from "@p0rt1on/shared/steps";

const STEP_MS = 450;

const stepsFor = (kind: DemoJob["kind"]): ReadonlyArray<{ key: string }> =>
  kind === "add" ? PROVISION_STEPS : OFFBOARD_STEPS;

/** Commit the job's effect exactly once (idempotent — a replay can't double-apply). */
const commit = (job: DemoJob): void => {
  updateDemoState((s) => {
    const existing = s.jobs[job.id];
    if (!existing || existing.committed) return s;
    const jobs = { ...s.jobs, [job.id]: { ...existing, committed: true } };
    if (job.kind === "add") {
      return {
        ...s,
        jobs,
        friends: [...s.friends, {
          ...job.friend,
          status: "active",
          instanceStatus: "active",
          nodeOnline: true,
        }],
      };
    }
    return {
      ...s,
      jobs,
      friends: s.friends.filter((f) => f.id !== job.friend.id),
    };
  });
};

const progress: SubscriptionHandler = (input, emit) => {
  const jobId = (input as { jobId: string }).jobId;
  const job = getDemoState().jobs[jobId];
  if (!job) {
    emit.data(
      {
        type: "error",
        message: "job not found (expired or manager restarted)",
        step: null,
      } satisfies JobProgressEvent,
    );
    emit.complete();
    return () => {};
  }

  const steps = stepsFor(job.kind);
  const failIdx = job.failStep === null
    ? -1
    : steps.findIndex((s) => s.key === job.failStep);
  const shown = failIdx >= 0 ? steps.slice(0, failIdx + 1) : steps;

  const stepTimers = shown.map((step, i) =>
    setTimeout(
      () =>
        emit.data(
          { type: "step", step: step.key } satisfies JobProgressEvent,
        ),
      (i + 1) * STEP_MS,
    )
  );
  const endTimer = setTimeout(() => {
    if (failIdx >= 0) {
      emit.data(
        {
          type: "error",
          message: "smoke test failed",
          step: job.failStep,
        } satisfies JobProgressEvent,
      );
    } else {
      commit(job);
      emit.data(
        {
          type: "done",
          bundleReady: job.bundle !== null,
        } satisfies JobProgressEvent,
      );
    }
    emit.complete();
  }, (shown.length + 1) * STEP_MS);

  return () => {
    stepTimers.forEach(clearTimeout);
    clearTimeout(endTimer);
  };
};

const activityStream: SubscriptionHandler = (input, emit) => {
  const friendId = (input as { friendId: number }).friendId;

  const current = () =>
    getDemoState().friends.find((f) => f.id === friendId)?.activity ?? null;

  const first = current();
  if (first) emit.data(first);
  const timer = setInterval(() => {
    const a = current();
    if (a) {
      emit.data({
        ...a,
        requests24h: a.requests24h + 1,
        updatedAt: new Date().toISOString(),
      });
    }
  }, 3000);
  return () => clearInterval(timer);
};

export const subscriptionHandlers: SubscriptionHandlers = {
  "jobs.progress": progress,
  "activity.stream": activityStream,
};

import type { FriendBundle } from "@p0rt1on/shared/domain";
import type { JobProgressEvent } from "@p0rt1on/shared/steps";
import type { ProgressEvent } from "../lib/progress.ts";
import type { Logger } from "../services/types.ts";
import { NotFoundError } from "../lib/ServiceError.ts";

// ============================================================================
// In-memory job registry: mutations START side-effectful work (provision /
// teardown) here and return a jobId immediately; the work runs detached from
// any connection. `progress` is a pure observer (replay + live), so SSE
// reconnects are always safe — they re-attach, never re-run. Jobs do NOT
// survive a manager restart: the friend row is left in `provisioning`/live
// state and boot reconcile owns recovery (PRD 2.2/4.2).
//
// Zero-knowledge note: an add job holds its once-shown FriendBundle in memory
// only until claimed (single claim, wiped on handover) or until the job is
// pruned — never in an event, the DB, or a log.
// ============================================================================

/** Finished jobs (and any unclaimed bundle) are dropped after this long. */
const JOB_TTL_MS = 15 * 60 * 1000;

/** One background job: an event log, its waiters, and the once-shown bundle. */
class Job {
  readonly events: JobProgressEvent[] = [];
  finished = false;
  finishedAt: number | null = null;
  bundle: FriendBundle | null = null;
  private readonly waiters = new Set<() => void>();

  constructor(
    readonly id: string,
    readonly kind: string,
    private readonly logger: Logger,
  ) {}

  /**
   * Consume a service generator, recording its step events. On `done`,
   * `captureBundle` (add flow) stashes the once-shown bundle for a single
   * claim. A throw becomes an `error` EVENT — observers see the failing
   * step; nothing propagates as a stream error.
   */
  async run<K extends string, R>(
    gen: AsyncGenerator<ProgressEvent<K, R>>,
    captureBundle?: (result: R) => FriendBundle,
  ): Promise<void> {
    try {
      // The generator IS the running work — consuming it as a stream is the
      // point; there is no collection to map over.
      // deno-lint-ignore custom-no-imperative-loops/no-imperative-loops
      for await (const ev of gen) {
        if (ev.type === "step") {
          this.emit({ type: "step", step: ev.step });
        } else {
          if (captureBundle) this.bundle = captureBundle(ev.result);
          this.emit({ type: "done", bundleReady: this.bundle !== null });
        }
      }
    } catch (err) {
      this.logger.warn("job failed", {
        kind: this.kind,
        jobId: this.id,
        step: this.lastStep(),
        error: String(err),
      });
      this.emit({
        type: "error",
        message: err instanceof Error ? err.message : String(err),
        step: this.lastStep(),
      });
    } finally {
      this.finished = true;
      this.finishedAt = Date.now();
      this.wakeAll();
    }
  }

  /** Replay events from `from`, then follow live ones until finished. */
  async *follow(from: number): AsyncGenerator<JobProgressEvent> {
    const batch = this.events.slice(from);
    yield* batch;
    const next = from + batch.length;
    // Events may have arrived while the batch was being consumed — replay
    // those before deciding whether to stop or wait.
    if (next < this.events.length) return yield* this.follow(next);
    if (this.finished) return;
    await this.nextEvent();
    yield* this.follow(next);
  }

  private emit(ev: JobProgressEvent): void {
    this.events.push(ev);
    this.wakeAll();
  }

  private lastStep(): string | null {
    const last = this.events.filter((e) => e.type === "step").at(-1);
    return last?.type === "step" ? last.step : null;
  }

  /** Resolves on the next emit or on finish. */
  private nextEvent(): Promise<void> {
    return new Promise((resolve) => {
      const wake = () => {
        this.waiters.delete(wake);
        resolve();
      };
      this.waiters.add(wake);
    });
  }

  private wakeAll(): void {
    [...this.waiters].forEach((wake) => wake());
  }
}

export class JobService {
  private readonly jobs = new Map<string, Job>();

  constructor(private readonly logger: Logger) {}

  /** Start consuming a generator in the background; returns immediately. */
  start<K extends string, R>(
    kind: string,
    gen: AsyncGenerator<ProgressEvent<K, R>>,
    captureBundle?: (result: R) => FriendBundle,
  ): string {
    this.prune();
    const job = new Job(crypto.randomUUID(), kind, this.logger);
    this.jobs.set(job.id, job);
    // Deliberately not awaited: the job outlives the starting request.
    job.run(gen, captureBundle);
    return job.id;
  }

  /**
   * Observer stream: replay recorded events, then follow live ones until the
   * job finishes. An unknown id (expired, or manager restarted) is itself an
   * `error` event — never a throw — so reconnecting clients get a renderable
   * outcome instead of a retry loop.
   */
  async *progress(jobId: string): AsyncGenerator<JobProgressEvent> {
    const job = this.jobs.get(jobId);
    if (!job) {
      yield {
        type: "error",
        message: "job not found (expired or manager restarted)",
        step: null,
      };
      return;
    }
    yield* job.follow(0);
  }

  /** Single-claim bundle handover: returns once, wiped immediately. */
  claimBundle(jobId: string): FriendBundle {
    const job = this.jobs.get(jobId);
    if (!job) throw new NotFoundError("job not found");
    const bundle = job.bundle;
    if (!bundle) {
      throw new NotFoundError("bundle already claimed or none produced");
    }
    job.bundle = null;
    return bundle;
  }

  /** Drop finished jobs past TTL (called on every start — no timers). */
  private prune(): void {
    const cutoff = Date.now() - JOB_TTL_MS;
    [...this.jobs.entries()]
      .filter(([, job]) =>
        job.finished && job.finishedAt !== null && job.finishedAt < cutoff
      )
      .forEach(([id]) => this.jobs.delete(id));
  }
}

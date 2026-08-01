import type { FriendBundle } from "@p0rt1on/shared/domain";
import type { JobProgressEvent } from "@p0rt1on/shared/steps";
import type { ProgressEvent } from "../lib/progress.ts";
import type { Logger } from "../services/types.ts";
import { NotFoundError } from "../lib/ServiceError.ts";

// Mutations start detached work and return a job id immediately; progress replays past events then
// follows live ones, so SSE reconnects re-attach rather than re-run. Jobs do not survive a manager restart; boot reconcile owns recovery.
//
// Zero-knowledge: an add job holds its once-shown FriendBundle in memory only until it is claimed
// once (then wiped) or pruned, and the bundle never appears in an event, the database, or a log.

const JOB_TTL_MS = 15 * 60 * 1000;

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

  // A thrown error becomes an `error` event rather than propagating as a stream error, so
  // observers see the failing step directly.
  async run<K extends string, R>(
    gen: AsyncGenerator<ProgressEvent<K, R>>,
    captureBundle?: (result: R) => FriendBundle,
    adviceOf?: (result: R) => string | undefined,
  ): Promise<void> {
    try {
      // deno-lint-ignore custom-no-imperative-loops/no-imperative-loops
      for await (const ev of gen) {
        if (ev.type === "step") {
          this.emit({ type: "step", step: ev.step });
        } else {
          if (captureBundle) this.bundle = captureBundle(ev.result);
          this.emit({
            type: "done",
            bundleReady: this.bundle !== null,
            // This advisory text about manual ACL offboarding is not a secret, so it may
            // ride the event, unlike the claim-only bundle.
            manualAclCleanup: adviceOf?.(ev.result),
          });
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

  async *follow(from: number): AsyncGenerator<JobProgressEvent> {
    const batch = this.events.slice(from);
    yield* batch;
    const next = from + batch.length;
    // Events may have arrived while the batch was being consumed, so those are replayed
    // before deciding whether to stop or wait.
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

  start<K extends string, R>(
    kind: string,
    gen: AsyncGenerator<ProgressEvent<K, R>>,
    captureBundle?: (result: R) => FriendBundle,
    adviceOf?: (result: R) => string | undefined,
  ): string {
    this.prune();
    const job = new Job(crypto.randomUUID(), kind, this.logger);
    this.jobs.set(job.id, job);
    // This call is deliberately not awaited, since the job outlives the request that started it.
    job.run(gen, captureBundle, adviceOf);
    return job.id;
  }

  // An unknown job id, from an expired job or a manager restart, produces an `error` event rather
  // than a throw, so reconnecting clients get a renderable outcome instead of a retry loop.
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

  // This call hands over the bundle exactly once, returning it and then wiping it immediately.
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

  private prune(): void {
    const cutoff = Date.now() - JOB_TTL_MS;
    [...this.jobs.entries()]
      .filter(([, job]) =>
        job.finished && job.finishedAt !== null && job.finishedAt < cutoff
      )
      .forEach(([id]) => this.jobs.delete(id));
  }
}

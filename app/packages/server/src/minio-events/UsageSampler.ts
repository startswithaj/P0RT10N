import type { McClientFactory } from "../minio/mc.ts";
import type { UsageSampleTarget } from "../db/FriendQueries.ts";
import type { Logger } from "../services/types.ts";
import type { MinioEventSubscription } from "./MinioEventSubscription.ts";
import type { FriendEvent } from "./resolveFriend.ts";

export interface UsageStore {
  usageSampleTargets(): Promise<UsageSampleTarget[]>;
  insertUsage(
    friendId: number,
    sample: { bytesUsed: number; objectCount: number },
  ): Promise<void>;
}

// Sampling is best-effort: a failed `mc du` logs and skips rather than
// throwing, since the next scheduled or audit-triggered sample will retry.

/** Trailing debounce: sample this long after a friend's LAST audit event. */
const ACTIVITY_DEBOUNCE_MS = 30_000;

/** The boot sample lands right after the boot reconcile's `mc admin service
 * restart`, so the first `mc du` may reliably hit a MinIO mid-restart. */
export interface SampleRetry {
  attempts: number;
  delayMs: number;
}

const DEFAULT_RETRY: SampleRetry = { attempts: 3, delayMs: 3_000 };

export class UsageSampler {
  private readonly pending = new Map<number, ReturnType<typeof setTimeout>>();
  /** Resolves when the event stream ends. The stream starts on construction;
   * await this in tests or for a clean shutdown. */
  readonly done: Promise<void>;

  constructor(
    private readonly events: MinioEventSubscription<FriendEvent>,
    private readonly queries: UsageStore,
    private readonly mc: McClientFactory,
    private readonly logger: Logger,
    private readonly debounceMs: number = ACTIVITY_DEBOUNCE_MS,
    private readonly retry: SampleRetry = DEFAULT_RETRY,
  ) {
    this.done = this.run();
  }

  /** The resolveFriend stage piped in at the call site already dropped this
   * sampler's own root-key polls, so measuring here never re-triggers itself. */
  private async run(): Promise<void> {
    try {
      // deno-lint-ignore custom-no-imperative-loops/no-imperative-loops
      for await (const { friendId } of this.events.events) {
        this.noteActivity(friendId);
      }
    } catch (err) {
      this.logger.error("minio event sampler stopped", { error: String(err) });
    }
  }

  async sampleAll(): Promise<number> {
    const targets = await this.queries.usageSampleTargets();
    const results = await Promise.all(
      targets.map((t) => this.sampleOne(t)),
    );
    return results.filter(Boolean).length;
  }

  /** Each call re-arms the friend's debounce timer, so the sample runs once,
   * `debounceMs` after the LAST event of a burst. */
  noteActivity(friendId: number): void {
    clearTimeout(this.pending.get(friendId));
    this.pending.set(
      friendId,
      setTimeout(() => {
        this.pending.delete(friendId);
        this.sampleFriend(friendId);
      }, this.debounceMs),
    );
  }

  dispose(): void {
    this.pending.forEach((timer) => clearTimeout(timer));
    this.pending.clear();
  }

  private async sampleFriend(friendId: number): Promise<void> {
    const targets = await this.queries.usageSampleTargets()
      .catch((err) => {
        this.logger.warn("usage sample target lookup failed", {
          friendId,
          error: String(err),
        });
        return [] as UsageSampleTarget[];
      });
    const target = targets.find((t) => t.friendId === friendId);
    // The friend may have been offboarded or suspended since the event arrived.
    if (target) await this.sampleOne(target);
  }

  private async sampleOne(
    target: UsageSampleTarget,
    attemptsLeft = this.retry.attempts,
  ): Promise<boolean> {
    try {
      const du = await this.mc.forInstance({
        alias: target.alias,
        minioPort: target.minioPort,
      }).du(target.bucket);
      await this.queries.insertUsage(target.friendId, du);
      return true;
    } catch (err) {
      if (attemptsLeft > 1) {
        await new Promise((resolve) => setTimeout(resolve, this.retry.delayMs));
        return this.sampleOne(target, attemptsLeft - 1);
      }
      this.logger.warn("usage sample failed", {
        friendId: target.friendId,
        bucket: target.bucket,
        error: String(err),
      });
      return false;
    }
  }
}

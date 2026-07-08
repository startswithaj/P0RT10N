// ============================================================================
// In-process FIFO mutex. Provisioning-mutating ops (add/offboard/rotate/sweep)
// are serialized through one instance — intentional for a single-admin app:
// it closes interleavings like reap-vs-add without distributed locking.
// Read-only queries never go through it.
// ============================================================================

export class Mutex {
  private tail: Promise<void> = Promise.resolve();

  /** Resolves once the lock is held; call the returned release exactly once. */
  private acquire(): Promise<() => void> {
    const { promise: held, resolve: release } = Promise.withResolvers<void>();
    const acquired = this.tail.then(() => release);
    this.tail = this.tail.then(() => held);
    return acquired;
  }

  /** Run `fn` exclusively. */
  async run<T>(fn: () => Promise<T>): Promise<T> {
    const release = await this.acquire();
    try {
      return await fn();
    } finally {
      release();
    }
  }

  /**
   * Run a streaming op exclusively — the lock spans the WHOLE stream (a
   * half-consumed add must not interleave with an offboard), released even
   * when the consumer abandons the stream (finally fires on return/throw).
   */
  async *runStream<T, R>(
    gen: () => AsyncGenerator<T, R>,
  ): AsyncGenerator<T, R> {
    const release = await this.acquire();
    try {
      return yield* gen();
    } finally {
      release();
    }
  }
}

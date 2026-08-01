// This FIFO mutex serializes provisioning ops (add/offboard/rotate/sweep) through
// one instance so interleavings like reap-vs-add can't happen; read-only queries bypass it.

export class Mutex {
  private tail: Promise<void> = Promise.resolve();

  /** Resolves once the lock is held; call the returned release exactly once. */
  private acquire(): Promise<() => void> {
    const { promise: held, resolve: release } = Promise.withResolvers<void>();
    const acquired = this.tail.then(() => release);
    this.tail = this.tail.then(() => held);
    return acquired;
  }

  async run<T>(fn: () => Promise<T>): Promise<T> {
    const release = await this.acquire();
    try {
      return await fn();
    } finally {
      release();
    }
  }

  /**
   * The lock spans the whole stream, so a half-consumed add can't interleave
   * with an offboard, and release still fires via `finally` if the consumer abandons the stream.
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

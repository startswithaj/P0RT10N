// The object each consumer receives: a live event stream plus the signal that
// tears it down (abort = unsubscribe). `pipe` chains a transform carrying the
// same signal, so consumers compose parse/resolve declaratively.

export interface MinioEventSubscription<T> {
  readonly events: AsyncIterable<T>;
  readonly signal: AbortSignal;
  pipe<U>(
    fn: (src: AsyncIterable<T>) => AsyncIterable<U>,
  ): MinioEventSubscription<U>;
}

export function subscription<T>(
  events: AsyncIterable<T>,
  signal: AbortSignal,
): MinioEventSubscription<T> {
  return {
    events,
    signal,
    pipe: (fn) => subscription(fn(events), signal),
  };
}

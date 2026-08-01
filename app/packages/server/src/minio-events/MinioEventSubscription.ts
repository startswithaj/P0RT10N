// Each consumer gets a live event stream and the signal that tears it down;
// aborting is how a consumer unsubscribes. `pipe` carries that signal forward.

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

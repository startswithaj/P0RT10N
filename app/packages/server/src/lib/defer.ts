/**
 * Defers execution a microtask and turns any throw into a promise rejection instead
 * of a synchronous throw, matching real `async` function semantics.
 */
export function defer<T>(body: () => T): Promise<T> {
  return Promise.resolve().then(body);
}

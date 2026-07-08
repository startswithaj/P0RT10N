/**
 * Run a synchronous body as a Promise with async semantics: execution is
 * deferred a microtask and any throw becomes a REJECTION (never a sync
 * throw), matching what an `async` function would do. For sync
 * implementations of Promise-returning interfaces (e.g. SQLite repos) —
 * callers attach `.catch()` and must never see a synchronous throw.
 */
export function defer<T>(body: () => T): Promise<T> {
  return Promise.resolve().then(body);
}

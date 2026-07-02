import type { ProgressEvent } from "../lib/progress.ts";

// Test helpers for the add/offboard progress generators. Live here (not in a
// *.test.ts) so the no-test-globals rule permits module-level functions.

/**
 * Drain a progress generator into its events + any terminal error. Recursion
 * (not a `for await` loop — the no-imperative-loops rule) and spreads (no param
 * mutation). Unlike Array.fromAsync, this keeps the events collected BEFORE a
 * throw, so tests can assert exactly where a failing stream stopped.
 */
export async function collect<K, R>(
  gen: AsyncGenerator<ProgressEvent<K, R>>,
  acc: readonly ProgressEvent<K, R>[] = [],
): Promise<{ events: ProgressEvent<K, R>[]; error: unknown }> {
  const next = await gen.next().then(
    (v) => ({ ok: true as const, v }),
    (e) => ({ ok: false as const, e }),
  );
  if (!next.ok) return { events: [...acc], error: next.e };
  if (next.v.done) return { events: [...acc], error: null };
  return collect(gen, [...acc, next.v.value]);
}

/** The step keys, in order, from a collected event list. */
export function stepKeys<K>(events: ProgressEvent<K, unknown>[]): K[] {
  return events.flatMap((e) => e.type === "step" ? [e.step] : []);
}

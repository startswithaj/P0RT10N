import type { ProgressEvent } from "../lib/progress.ts";

// Test helpers for the add/offboard progress generators. Live here (not in a
// *.test.ts) so the no-test-globals rule permits module-level functions.

/**
 * Recursion, not a for-await loop, satisfies the no-imperative-loops rule.
 * Unlike Array.fromAsync, this keeps events collected before a throw.
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

export function stepKeys<K>(events: ProgressEvent<K, unknown>[]): K[] {
  return events.flatMap((e) => e.type === "step" ? [e.step] : []);
}

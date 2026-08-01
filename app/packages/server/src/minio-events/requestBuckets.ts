// Rolling 24h request counts are windowed hourly buckets summed on read, so
// the count decays to zero as a friend idles rather than freezing.

/** Each key is an hour-epoch (floor(ms / 1h)) stored as a string, mapped to
 * the request count for that hour. */
export type RequestBuckets = Record<string, number>;

const WINDOW_HOURS = 24;
const HOUR_MS = 3_600_000;

function hourOf(iso: string): number | null {
  const ms = new Date(iso).getTime();
  return Number.isFinite(ms) ? Math.floor(ms / HOUR_MS) : null;
}

export function hourKey(iso: string): string {
  const hour = hourOf(iso);
  if (hour === null) throw new Error(`unparseable timestamp: ${iso}`);
  return String(hour);
}

function cutoff(now: string): number | null {
  const hour = hourOf(now);
  return hour === null ? null : hour - (WINDOW_HOURS - 1);
}

/** An unparseable `at` is not counted, and an unparseable `now` skips pruning,
 * leaving existing buckets untouched rather than risking data loss. */
export function bump(
  buckets: RequestBuckets,
  at: string,
  now: string,
): RequestBuckets {
  const hour = hourOf(at);
  const next = hour === null
    ? { ...buckets }
    : { ...buckets, [hour]: (buckets[hour] ?? 0) + 1 };
  return prune(next, now);
}

/** Buckets older than the window or future-dated are both dropped, so a
 * skewed event timestamp can't be counted in every 24h sum forever. */
export function prune(buckets: RequestBuckets, now: string): RequestBuckets {
  const oldest = cutoff(now);
  if (oldest === null) return { ...buckets };
  const newest = oldest + WINDOW_HOURS - 1;
  return Object.fromEntries(
    Object.entries(buckets).filter(([hour]) =>
      Number(hour) >= oldest && Number(hour) <= newest
    ),
  );
}

/** Must use the same window as `sumLast24h` so the sparkline and the total
 * agree. */
export function hourlySeries(buckets: RequestBuckets, now: string): number[] {
  const oldest = cutoff(now);
  if (oldest === null) return [];
  return Array.from(
    { length: WINDOW_HOURS },
    (_, i) => buckets[String(oldest + i)] ?? 0,
  );
}

export function sumLast24h(buckets: RequestBuckets, now: string): number {
  const oldest = cutoff(now);
  return Object.entries(buckets).reduce(
    (total, [hour, count]) =>
      oldest === null || Number(hour) >= oldest ? total + count : total,
    0,
  );
}

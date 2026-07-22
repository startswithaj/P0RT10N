// ============================================================================
// Rolling 24h request counting via hourly buckets. The `activity` row keeps a
// compact map of hour-epoch -> request count (at most ~25 entries per friend).
// Writes bump the current hour and prune anything past the window; reads sum
// the buckets still inside the window. Keeping the window on the *read* means
// the count decays to zero as a friend goes idle, instead of freezing at its
// last value (which is what a plain running counter did).
// ============================================================================

/** hour-epoch (floor(ms / 1h), as a string key) -> request count in that hour. */
export type RequestBuckets = Record<string, number>;

/** Hours in the rolling window. 24 buckets ≈ "the last 24 hours" (hour-coarse). */
const WINDOW_HOURS = 24;
const HOUR_MS = 3_600_000;

/** The whole-hour bucket an ISO timestamp falls in, or null if unparseable. */
function hourOf(iso: string): number | null {
  const ms = new Date(iso).getTime();
  return Number.isFinite(ms) ? Math.floor(ms / HOUR_MS) : null;
}

/** The bucket key for an ISO timestamp (throws on unparseable input). */
export function hourKey(iso: string): string {
  const hour = hourOf(iso);
  if (hour === null) throw new Error(`unparseable timestamp: ${iso}`);
  return String(hour);
}

/** The oldest hour still inside the window ending at `now` (null if `now` bad). */
function cutoff(now: string): number | null {
  const hour = hourOf(now);
  return hour === null ? null : hour - (WINDOW_HOURS - 1);
}

/**
 * Record one request at `at`, then drop buckets older than the window ending at
 * `now`. An unparseable `now` leaves existing buckets untouched (prune is a
 * best-effort trim, never a data-loss risk); an unparseable `at` is not counted.
 */
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

/**
 * Drop buckets outside the window ending at `now` — older than the window OR
 * future-dated (a skewed event timestamp would otherwise be counted in every
 * 24h sum until the clock catches up to it).
 */
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

/**
 * Hourly counts across the window ending at `now`, oldest→newest (fixed length
 * WINDOW_HOURS). Missing hours are 0; empty when `now` is unparseable. Feeds the
 * Status-page sparkline — same window as `sumLast24h`.
 */
export function hourlySeries(buckets: RequestBuckets, now: string): number[] {
  const oldest = cutoff(now);
  if (oldest === null) return [];
  return Array.from(
    { length: WINDOW_HOURS },
    (_, i) => buckets[String(oldest + i)] ?? 0,
  );
}

/** Sum of requests within the window ending at `now`. */
export function sumLast24h(buckets: RequestBuckets, now: string): number {
  const oldest = cutoff(now);
  return Object.entries(buckets).reduce(
    (total, [hour, count]) =>
      oldest === null || Number(hour) >= oldest ? total + count : total,
    0,
  );
}

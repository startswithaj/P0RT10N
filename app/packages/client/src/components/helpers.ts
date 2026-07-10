import type { StatusView } from "@p0rt1on/shared/domain";
import { queryClient } from "../trpc.ts";

const GB = 1_000_000_000;
export const gb = (bytes: number) => `${(bytes / GB).toFixed(1)} GB`;

export const pct = (fraction: number) =>
  Math.min(100, Math.round(fraction * 100));

// Staleness nudge (PLAN wireframe): a friend whose backups quietly stopped is
// the product's core early-warning signal. Nudge after 48h of silence; friends
// who never connected get a neutral note instead of a false alarm.
const STALE_AFTER_MS = 48 * 60 * 60 * 1000;

export function relativeTime(ms: number): string {
  const days = Math.floor(ms / 86_400_000);
  if (days > 0) return days === 1 ? "1 day ago" : `${days} days ago`;
  const hours = Math.floor(ms / 3_600_000);
  if (hours > 0) return hours === 1 ? "1 hour ago" : `${hours} hours ago`;
  const minutes = Math.floor(ms / 60_000);
  if (minutes > 0) {
    return minutes === 1 ? "1 minute ago" : `${minutes} minutes ago`;
  }
  return "just now";
}

/** Always renders: recent activity as a muted timestamp, silence past the
 * threshold as the amber nudge, never-connected as a neutral note. */
export function staleness(
  lastRequestAt: string | null,
): { label: string; warn: boolean } {
  if (lastRequestAt === null) {
    return { label: "never connected", warn: false };
  }
  const age = Date.now() - new Date(lastRequestAt).getTime();
  if (age < STALE_AFTER_MS) {
    return { label: `last activity ${relativeTime(age)}`, warn: false };
  }
  return { label: `no backups since ${relativeTime(age)}`, warn: true };
}

export const invalidate = () =>
  queryClient.invalidateQueries({ queryKey: ["friends"] });

/**
 * Aggregate system health for the footer, from the same `status.get` snapshot
 * the Status page renders: backend unreachable or any service `down` ⇒
 * unhealthy. `provisioning` is transitional, not unhealthy.
 */
export function systemHealth(
  q: { isError: boolean; data?: StatusView },
): "healthy" | "unhealthy" | "checking" {
  if (q.isError) return "unhealthy";
  if (!q.data) return "checking";
  const services = [...q.data.minio, ...q.data.tailscale, ...q.data.host];
  return services.some((s) => s.state === "down") ? "unhealthy" : "healthy";
}

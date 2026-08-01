import type { StatusView } from "@p0rt1on/shared/domain";
import { queryClient } from "../trpc.ts";

const GB = 1_000_000_000;
export const gb = (bytes: number) => `${(bytes / GB).toFixed(1)} GB`;

export const pct = (fraction: number) =>
  Math.min(100, Math.round(fraction * 100));

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

// Demo mode mocks a static backend, so polling would only churn the UI
// without fetching anything new.
export const pollMs = (ms: number): number | false =>
  import.meta.env.VITE_DEMO_MODE === "1" ? false : ms;

/** `offboarding` means a teardown is in progress, distinct from a real fault. */
export type SystemHealth = "healthy" | "unhealthy" | "offboarding" | "checking";

export function systemHealth(
  q: { isError: boolean; data?: StatusView },
): SystemHealth {
  if (q.isError) return "unhealthy";
  if (!q.data) return "checking";
  const services = [...q.data.minio, ...q.data.tailscale, ...q.data.host];
  // A genuine `down` outranks teardown: a real fault must still read unhealthy
  // even if something else is offboarding at the same time.
  if (services.some((s) => s.state === "down")) return "unhealthy";
  if (services.some((s) => s.state === "pending")) return "offboarding";
  return "healthy";
}

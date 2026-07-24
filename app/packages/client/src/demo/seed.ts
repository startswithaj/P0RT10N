// Seed data — a few friends in varied states + a short audit trail. Real domain
// shapes (reuses the view types); mutated copies flow through state.ts.

import type { DemoFriend, DemoState } from "./state.ts";
import type {
  ActivityView,
  AuditEntryView,
  UsageView,
} from "@p0rt1on/shared/domain";

const GB = 1_000_000_000;

// Timestamps relative to load time so the demo always looks live ("minutes ago",
// not a fixed date that drifts stale). Persisted with state; a new tab re-seeds fresh.
const minsAgo = (m: number): string =>
  new Date(Date.now() - m * 60_000).toISOString();

const usage = (usedGb: number, quotaGb: number): UsageView => ({
  bytesUsed: usedGb * GB,
  objectCount: Math.round(usedGb * 40),
  quotaBytes: quotaGb * GB,
  fraction: quotaGb > 0 ? Math.min(1, usedGb / quotaGb) : 0,
  checkedAt: minsAgo(9),
});

// `lastMins` = minutes since the friend's last request (varies per friend so
// they don't all read "23 minutes ago"). Ignored when there's no activity.
const activity = (
  total: number,
  last24: number,
  lastMins: number,
): ActivityView => ({
  requestsTotal: total,
  requestsByOp: total > 0 ? { "s3.PutObject": total } : {},
  requests24h: last24,
  lastRequestAt: last24 > 0 ? minsAgo(lastMins) : null,
  lastOp: last24 > 0 ? "s3.PutObject" : null,
  bytesInTotal: total * 1000,
  bytesOutTotal: total * 10,
  deniedCount: 0,
  updatedAt: last24 > 0 ? minsAgo(lastMins) : minsAgo(4),
});

const friend = (
  over: Partial<DemoFriend> & Pick<DemoFriend, "id" | "name">,
): DemoFriend => ({
  isolationMode: "dedicated",
  status: "active",
  lockMode: "GOVERNANCE",
  lockRetentionDays: 30,
  usage: usage(5, 100),
  activity: activity(1200, 8, 30),
  enrollmentMode: "authKey",
  inviteStatus: null,
  bucket: `${over.name}-backups`,
  s3AccessKeyId: "AKIADEMOACCESSKEY",
  tsNodeTag: `tag:p0rt1on-friend-${over.name}`,
  s3Endpoint: `https://${over.name}.taildemo.ts.net`,
  instanceKind: "dedicated",
  instanceStatus: "active",
  nodeOnline: true,
  ...over,
});

export const seedFriends = (): DemoFriend[] => [
  friend({
    id: 1,
    name: "alice",
    usage: usage(5, 100),
    activity: activity(4800, 96, 41), // light-moderate; last backup 41m ago
  }),
  friend({
    id: 2,
    name: "bob",
    isolationMode: "shared",
    instanceKind: "shared",
    usage: usage(80, 100), // near-quota → warning bar
    activity: activity(50_000, 380, 4), // heavy; backing up right now
  }),
  friend({
    id: 3,
    name: "carol",
    status: "suspended",
    instanceStatus: "stopped",
    nodeOnline: false,
    activity: activity(900, 0, 0), // suspended → no recent activity
  }),
  friend({
    id: 4,
    name: "dave",
    status: "provisioning",
    instanceStatus: "provisioning",
    nodeOnline: false,
    s3AccessKeyId: null,
    usage: usage(0, 50),
    activity: activity(0, 0, 0), // provisioning → not backing up yet
  }),
];

// Recent-events log, relative to load time (hours→days ago) so it reads as a
// live trail, not a fixed date that ages.
const hoursAgo = (h: number): string =>
  new Date(Date.now() - h * 3_600_000).toISOString();

export const seedAudit = (): AuditEntryView[] => [
  {
    id: 5,
    when: hoursAgo(3),
    action: "add_friend",
    friend: "bob",
    detail: null,
  },
  {
    id: 4,
    when: hoursAgo(20),
    action: "resize",
    friend: "alice",
    detail: "100 GB",
  },
  {
    id: 3,
    when: hoursAgo(29),
    action: "suspend",
    friend: "carol",
    detail: null,
  },
  {
    id: 2,
    when: hoursAgo(52),
    action: "add_friend",
    friend: "alice",
    detail: null,
  },
  { id: 1, when: hoursAgo(76), action: "login", friend: null, detail: null },
];

/** Fresh seed state. `seq` starts above every seeded id so new ids never collide. */
export const seedState = (): DemoState => ({
  friends: seedFriends(),
  audit: seedAudit(),
  jobs: {},
  seq: 100,
});

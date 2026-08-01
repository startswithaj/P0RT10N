import type { DemoFriend, DemoState } from "./state.ts";
import type {
  ActivityView,
  AuditEntryView,
  UsageView,
} from "@p0rt1on/shared/domain";

const GB = 1_000_000_000;

// Timestamps are calculated relative to load time so the seed always looks live
// rather than aging into a fixed stale date; a new tab re-seeds everything fresh.
const minsAgo = (m: number): string =>
  new Date(Date.now() - m * 60_000).toISOString();

const usage = (usedGb: number, quotaGb: number): UsageView => ({
  bytesUsed: usedGb * GB,
  objectCount: Math.round(usedGb * 40),
  quotaBytes: quotaGb * GB,
  fraction: quotaGb > 0 ? Math.min(1, usedGb / quotaGb) : 0,
  checkedAt: minsAgo(9),
});

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
    activity: activity(4800, 96, 41),
  }),
  friend({
    id: 2,
    name: "bob",
    isolationMode: "shared",
    instanceKind: "shared",
    usage: usage(80, 100),
    activity: activity(50_000, 380, 4),
  }),
  friend({
    id: 3,
    name: "carol",
    status: "suspended",
    instanceStatus: "stopped",
    nodeOnline: false,
    activity: activity(900, 0, 0),
  }),
  friend({
    id: 4,
    name: "dave",
    status: "provisioning",
    instanceStatus: "provisioning",
    nodeOnline: false,
    s3AccessKeyId: null,
    usage: usage(0, 50),
    activity: activity(0, 0, 0),
  }),
];

// Audit timestamps are also relative to load time, from hours to days ago, so
// the log reads as a live trail rather than aging into a fixed date.
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

/** seq starts above every seeded id, so new friends and audit rows never collide with seed ids. */
export const seedState = (): DemoState => ({
  friends: seedFriends(),
  audit: seedAudit(),
  jobs: {},
  seq: 100,
});

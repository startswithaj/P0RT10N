// The demo's in-memory "database". A canonical DemoFriend holds the union of the
// FriendListItem and FriendDetail fields; the two views are pure projections of
// it. Persisted to sessionStorage (survives reload, resets on tab close). All
// module-load access is lazy so the graph is side-effect-free (→ tree-shaken out
// of the real build, and importable under Deno for the coverage test).

import type {
  ActivityView,
  AuditEntryView,
  EnrollmentMode,
  FriendBundle,
  FriendDetail,
  FriendListItem,
  FriendStatus,
  InstanceKind,
  InstanceStatus,
  InviteStatus,
  IsolationMode,
  LockMode,
  UsageView,
} from "@p0rt1on/shared/domain";
import { seedState } from "./seed.ts";

/** One friend, holding every field either view needs. */
export interface DemoFriend {
  id: number;
  name: string;
  isolationMode: IsolationMode;
  status: FriendStatus;
  lockMode: LockMode;
  lockRetentionDays: number;
  usage: UsageView;
  activity: ActivityView;
  enrollmentMode: EnrollmentMode;
  inviteStatus: InviteStatus | null;
  // detail-only facts
  bucket: string;
  s3AccessKeyId: string | null;
  tsNodeTag: string;
  s3Endpoint: string;
  instanceKind: InstanceKind;
  instanceStatus: InstanceStatus;
  nodeOnline: boolean;
  // invite detail (invite enrollment only)
  inviteEmail?: string;
  inviteUrl?: string;
  inviteEmailedAt?: string;
}

/** A background add/offboard job the progress subscription drives. */
export interface DemoJob {
  id: string;
  kind: "add" | "offboard";
  /** add: the pending friend to commit on done; offboard: the target to remove. */
  friend: DemoFriend;
  /** add: the once-shown bundle, nulled on claim. */
  bundle: FriendBundle | null;
  /** step key to fail on (the `fail-smoke` demo), or null for the happy path. */
  failStep: string | null;
  committed: boolean;
}

export interface DemoState {
  friends: DemoFriend[];
  audit: AuditEntryView[];
  jobs: Record<string, DemoJob>;
  /** Monotonic id source for new friends + audit rows. */
  seq: number;
}

const KEY = "p0rt1on-demo-state";
// Bump when the seed shape/content changes so a stale persisted blob (from a
// previous demo build) is discarded and re-seeded rather than shown.
const SCHEMA_VERSION = 3;
type Persisted = Pick<DemoState, "friends" | "audit" | "seq"> & { v: number };

const isPersisted = (v: unknown): v is Persisted => {
  if (typeof v !== "object" || v === null) return false;
  const o = v as Record<string, unknown>;
  return o.v === SCHEMA_VERSION && Array.isArray(o.friends) &&
    Array.isArray(o.audit) && typeof o.seq === "number";
};

const load = (): DemoState | null => {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (isPersisted(parsed)) return { ...parsed, jobs: {} };
    console.warn("demo: persisted state has an unexpected shape, using seed");
    return null;
  } catch (err) {
    console.warn("demo: failed to read persisted state, using seed", err);
    return null;
  }
};

const save = (s: DemoState): void => {
  try {
    const persisted: Persisted = {
      v: SCHEMA_VERSION,
      friends: s.friends,
      audit: s.audit,
      seq: s.seq,
    };
    sessionStorage.setItem(KEY, JSON.stringify(persisted));
  } catch (err) {
    console.warn("demo: failed to persist state", err);
  }
};

// Lazy session singleton via a const holder (no `let`, no lint suppression).
const store: { current: DemoState | null } = { current: null };
const ensure = (): DemoState => (store.current ??= load() ?? seedState());

export const getDemoState = (): DemoState => ensure();

/** Apply a pure update (fn returns a fresh state — never mutates its arg), persist, return it. */
export const updateDemoState = (fn: (s: DemoState) => DemoState): DemoState => {
  const next = fn(ensure());
  store.current = next;
  save(next);
  return next;
};

/** Test-only: drop the singleton so the next access re-seeds. */
export const resetDemoState = (): void => {
  store.current = null;
};

export const findFriend = (
  s: DemoState,
  id: number,
): DemoFriend | undefined => s.friends.find((f) => f.id === id);

export const requireFriend = (s: DemoState, id: number): DemoFriend => {
  const f = findFriend(s, id);
  if (!f) throw new Error(`demo: friend ${id} not found`);
  return f;
};

export const toListItem = (f: DemoFriend): FriendListItem => ({
  id: f.id,
  name: f.name,
  isolationMode: f.isolationMode,
  status: f.status,
  lockMode: f.lockMode,
  lockRetentionDays: f.lockRetentionDays,
  usage: f.usage,
  requests24h: f.activity.requests24h,
  lastRequestAt: f.activity.lastRequestAt,
  enrollmentMode: f.enrollmentMode,
  inviteStatus: f.inviteStatus,
});

export const toDetail = (f: DemoFriend): FriendDetail => ({
  id: f.id,
  name: f.name,
  isolationMode: f.isolationMode,
  status: f.status,
  bucket: f.bucket,
  s3AccessKeyId: f.s3AccessKeyId,
  tsNodeTag: f.tsNodeTag,
  lockMode: f.lockMode,
  lockRetentionDays: f.lockRetentionDays,
  s3Endpoint: f.s3Endpoint,
  instanceKind: f.instanceKind,
  instanceStatus: f.instanceStatus,
  nodeOnline: f.nodeOnline,
  usage: f.usage,
  activity: f.activity,
});

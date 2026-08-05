// DemoFriend holds every field that FriendListItem or FriendDetail needs; toListItem and toDetail below are pure projections and must stay in sync with those shared types.
// State loads lazily on first access, keeping this module side-effect-free so it tree-shakes out of the production build and stays importable under Deno for the coverage test.

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
  bucket: string;
  s3AccessKeyId: string | null;
  tsNodeTag: string;
  s3Endpoint: string;
  instanceKind: InstanceKind;
  instanceStatus: InstanceStatus;
  nodeOnline: boolean;
  inviteEmail?: string;
  inviteUrl?: string;
  inviteEmailedAt?: string;
}

export interface DemoJob {
  id: string;
  kind: "add" | "offboard";
  /** For an add job this is the pending friend to commit once it finishes; for an offboard job it is the target to remove. */
  friend: DemoFriend;
  /** For an add job this is the once-shown bundle; it becomes null once the client claims it. */
  bundle: FriendBundle | null;
  /** The step key to fail on, used by the fail-smoke demo scenario; null follows the happy path. */
  failStep: string | null;
  committed: boolean;
}

export interface DemoState {
  friends: DemoFriend[];
  audit: AuditEntryView[];
  jobs: Record<string, DemoJob>;
  /** seq is a single monotonic id counter shared by new friends and audit rows. */
  seq: number;
}

const KEY = "p0rt1on-demo-state";
// Bump this whenever the seed shape or content changes, so a stale persisted
// blob from a previous demo build is discarded and re-seeded instead of shown.
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

// The store is a const object holder acting as a mutable singleton, avoiding a
// `let` binding since lint disallows it and this codebase never suppresses lint.
const store: { current: DemoState | null } = { current: null };
const ensure = (): DemoState => (store.current ??= load() ?? seedState());

export const getDemoState = (): DemoState => ensure();

/** Applies a pure update function that must return a fresh state without
 *  mutating its argument, then persists and returns the result. */
export const updateDemoState = (fn: (s: DemoState) => DemoState): DemoState => {
  const next = fn(ensure());
  store.current = next;
  save(next);
  return next;
};

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
  hostnameWarning: null,
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

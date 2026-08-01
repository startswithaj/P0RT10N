import type { MutationHandlers } from "./types.ts";
import type { DemoFriend, DemoState } from "../state.ts";
import {
  getDemoState,
  requireFriend,
  toDetail,
  updateDemoState,
} from "../state.ts";
import type { MutationInput } from "../paths.ts";
import type {
  AuditAction,
  FriendBundle,
  FriendDetail,
} from "@p0rt1on/shared/domain";

type AddInput = MutationInput<"friends.addStart">;

const GB = 1_000_000_000;
const gb = (bytes: number): number => Math.round(bytes / GB);

// crypto.randomUUID() requires a secure context and throws when the demo is
// opened over plain HTTP on a LAN IP, so this uses getRandomValues instead.
const randomHex = (n: number): string => {
  const bytes = new Uint8Array(Math.ceil(n / 2));
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, n);
};

const uid = (n: number): string => randomHex(n);

const nowIso = (): string => new Date().toISOString();

const patchFriend = (
  s: DemoState,
  id: number,
  fn: (f: DemoFriend) => DemoFriend,
): DemoState => ({
  ...s,
  friends: s.friends.map((f) => (f.id === id ? fn(f) : f)),
});

/** Consumes one id from the shared seq counter for the new audit row. */
const appendAudit = (
  s: DemoState,
  action: AuditAction,
  friend: string | null,
  detail: string | null,
): DemoState => {
  const id = s.seq + 1;
  return {
    ...s,
    seq: id,
    audit: [{ id, when: nowIso(), action, friend, detail }, ...s.audit],
  };
};

const nameOf = (s: DemoState, id: number): string | null =>
  s.friends.find((f) => f.id === id)?.name ?? null;

const detailAfter = (
  id: number,
  reducer: (s: DemoState) => DemoState,
): FriendDetail => toDetail(requireFriend(updateDemoState(reducer), id));

/** The real offboard mutation returns `{ ok: true } & OffboardResult`; this
 *  demo build just removes the friend, since there is no teardown to report. */
const okAfter = (reducer: (s: DemoState) => DemoState): { ok: true } => {
  updateDemoState(reducer);
  return { ok: true as const };
};

// This mirrors the server's private kopiaQuickstart method byte-for-byte, so
// the demo reads exactly like production; keep the two in sync if either changes.

const kopiaCreateTail = (retentionDays: number): string[] => [
  `  --retention-mode=GOVERNANCE --retention-period=${retentionDays}d`,
  "",
  "# Then back up a directory (immutable for the retention window):",
  "kopia snapshot create /path/to/your/data",
];

const authKeyJoinLines = (upCommand: string): string[] => [
  "# Join the tailnet (redeems your single-use key):",
  upCommand,
  "",
];

const inviteJoinLines = (): string[] => [
  "# After accepting the invite, generate an auth key in your Tailscale admin",
  "# console (https://login.tailscale.com/admin/settings/keys), then join:",
  "tailscale up --authkey=<your-tailscale-auth-key>",
  "",
];

const kopiaQuickstart = (opts: {
  endpoint: string;
  bucket: string;
  accessKeyId: string;
  secretKey: string;
  retentionDays: number;
  create: boolean;
  joinLines: string[];
}): string => {
  const host = opts.endpoint.replace(/^https?:\/\//, "");
  const password = opts.create
    ? "# Choose YOUR OWN password — client-side only, NEVER sent to us, and"
    : "# Use the SAME KOPIA_PASSWORD you set when the repo was created —";
  const lastCredFlag = opts.create
    ? `  --secret-access-key=${opts.secretKey} \\`
    : `  --secret-access-key=${opts.secretKey}`;
  const tail = opts.create ? kopiaCreateTail(opts.retentionDays) : [];
  return [
    ...opts.joinLines,
    password,
    "# UNRECOVERABLE if lost:",
    "export KOPIA_PASSWORD='change-me-to-a-strong-passphrase'",
    "",
    `kopia repository ${opts.create ? "create" : "connect"} s3 \\`,
    `  --bucket=${opts.bucket} \\`,
    `  --endpoint=${host} \\`,
    `  --access-key=${opts.accessKeyId} \\`,
    lastCredFlag,
    ...tail,
  ].join("\n");
};

const joinLinesFor = (
  includeEnrollment: boolean,
  isInvite: boolean,
  upCommand: string,
): string[] => {
  if (!includeEnrollment) return [];
  if (isInvite) return inviteJoinLines();
  return authKeyJoinLines(upCommand);
};

const bundleFor = (f: DemoFriend, includeEnrollment: boolean): FriendBundle => {
  const s3AccessKeyId = f.s3AccessKeyId ?? `AKIA${uid(8).toUpperCase()}`;
  const s3SecretKey = `demo-secret-${uid(16)}`;
  const tsKey = `tskey-auth-demo-${uid(10)}`;
  const upCommand = `tailscale up --authkey=${tsKey}`;
  const isInvite = f.enrollmentMode === "invite";
  const base: FriendBundle = {
    name: f.name,
    s3Endpoint: f.s3Endpoint,
    bucket: f.bucket,
    s3AccessKeyId,
    s3SecretKey,
    kopiaQuickstart: kopiaQuickstart({
      endpoint: f.s3Endpoint,
      bucket: f.bucket,
      accessKeyId: s3AccessKeyId,
      secretKey: s3SecretKey,
      retentionDays: f.lockRetentionDays,
      create: includeEnrollment,
      joinLines: joinLinesFor(includeEnrollment, isInvite, upCommand),
    }),
  };
  if (!includeEnrollment) return base;
  if (isInvite) {
    return {
      ...base,
      enrollmentMode: "invite",
      inviteEmail: f.inviteEmail,
      inviteUrl: `https://login.tailscale.com/invite/demo-${f.name}`,
    };
  }
  return {
    ...base,
    enrollmentMode: "authKey",
    tsAuthKey: tsKey,
    tailscaleUpCommand: upCommand,
  };
};

const friendFromInput = (id: number, input: AddInput): DemoFriend => {
  const enroll = input.enrollment ?? { mode: "authKey" as const };
  return {
    id,
    name: input.name,
    isolationMode: input.isolationMode,
    status: "active",
    lockMode: input.lockMode ?? "GOVERNANCE",
    lockRetentionDays: input.retentionDays,
    usage: {
      bytesUsed: 0,
      objectCount: 0,
      quotaBytes: input.quotaBytes,
      fraction: 0,
      checkedAt: null,
    },
    activity: {
      requestsTotal: 0,
      requestsByOp: {},
      requests24h: 0,
      lastRequestAt: null,
      lastOp: null,
      bytesInTotal: 0,
      bytesOutTotal: 0,
      deniedCount: 0,
      updatedAt: nowIso(),
    },
    enrollmentMode: enroll.mode === "invite" ? "invite" : "authKey",
    inviteStatus: enroll.mode === "invite" ? "pending" : null,
    bucket: `${input.name}-backups`,
    s3AccessKeyId: `AKIA${uid(8).toUpperCase()}`,
    tsNodeTag: `tag:p0rt1on-friend-${input.name}`,
    s3Endpoint: `https://${input.name}.taildemo.ts.net`,
    instanceKind: input.isolationMode,
    instanceStatus: "active",
    nodeOnline: true,
    inviteEmail: enroll.mode === "invite" ? enroll.email : undefined,
  };
};

export const mutationHandlers: MutationHandlers = {
  "auth.login": () => ({ ok: true }),
  "auth.logout": () => ({ ok: true }),
  "status.recheckHealth": () => ({
    checks: [],
    canProvision: true,
    probedAt: "2026-06-30T12:00:00Z",
  }),

  "friends.add": (input) => {
    const fid = getDemoState().seq + 1;
    const f = friendFromInput(fid, input);
    updateDemoState((s) =>
      appendAudit(
        { ...s, seq: fid, friends: [...s.friends, f] },
        "add_friend",
        f.name,
        null,
      )
    );
    return bundleFor(f, true);
  },

  "friends.addStart": (input) => {
    const jobId = randomHex(32);
    const fid = getDemoState().seq + 1;
    const f: DemoFriend = {
      ...friendFromInput(fid, input),
      status: "provisioning",
      instanceStatus: "provisioning",
      nodeOnline: false,
    };
    const bundle = bundleFor(f, true);
    const failStep = input.name === "fail-smoke" ? "smoke" : null;
    updateDemoState((s) => ({
      ...s,
      seq: fid,
      jobs: {
        ...s.jobs,
        [jobId]: {
          id: jobId,
          kind: "add",
          friend: f,
          bundle,
          failStep,
          committed: false,
        },
      },
    }));
    return { jobId };
  },

  "friends.offboardStart": (input) => {
    const jobId = randomHex(32);
    const target = requireFriend(getDemoState(), input.friendId);
    updateDemoState((s) => ({
      ...s,
      jobs: {
        ...s.jobs,
        [jobId]: {
          id: jobId,
          kind: "offboard",
          friend: target,
          bundle: null,
          failStep: null,
          committed: false,
        },
      },
    }));
    return { jobId };
  },

  "friends.offboard": (input) =>
    okAfter((s) =>
      appendAudit(
        { ...s, friends: s.friends.filter((f) => f.id !== input.friendId) },
        "offboard",
        nameOf(s, input.friendId),
        null,
      )
    ),

  "friends.resize": (input) =>
    detailAfter(input.friendId, (s) =>
      appendAudit(
        patchFriend(s, input.friendId, (f) => ({
          ...f,
          usage: {
            ...f.usage,
            quotaBytes: input.quotaBytes,
            fraction: input.quotaBytes > 0
              ? Math.min(1, f.usage.bytesUsed / input.quotaBytes)
              : 0,
          },
        })),
        "resize",
        nameOf(s, input.friendId),
        `${gb(input.quotaBytes)} GB`,
      )),

  "friends.suspend": (input) =>
    detailAfter(input.friendId, (s) =>
      appendAudit(
        patchFriend(s, input.friendId, (f) => ({
          ...f,
          status: "suspended",
          instanceStatus: "stopped",
          nodeOnline: false,
        })),
        "suspend",
        nameOf(s, input.friendId),
        null,
      )),

  "friends.resume": (input) =>
    detailAfter(input.friendId, (s) =>
      appendAudit(
        patchFriend(s, input.friendId, (f) => ({
          ...f,
          status: "active",
          instanceStatus: "active",
        })),
        "resume",
        nameOf(s, input.friendId),
        null,
      )),

  "friends.rotateKey": (input) => {
    const f = requireFriend(getDemoState(), input.friendId);
    updateDemoState((s) => appendAudit(s, "rotate_key", f.name, null));
    // rotateKey omits the Tailscale fields here, matching how the real mutation
    // only rotates the S3 secret and leaves Tailscale enrollment untouched.
    return bundleFor(f, false);
  },

  "friends.reissueTsKey": (input) => {
    const f = requireFriend(getDemoState(), input.friendId);
    updateDemoState((s) => appendAudit(s, "reissue_ts_key", f.name, null));
    const key = `tskey-auth-demo-${uid(10)}`;
    return {
      name: f.name,
      tsAuthKey: key,
      tailscaleUpCommand: `tailscale up --authkey=${key}`,
    };
  },

  "friends.resendInvite": (input) => {
    updateDemoState((s) =>
      patchFriend(s, input.friendId, (f) => ({
        ...f,
        inviteEmailedAt: nowIso(),
      }))
    );
    // This mutation returns void in the real API, so there is nothing to return here.
  },

  "jobs.claimBundle": (input) => {
    const job = getDemoState().jobs[input.jobId];
    if (!job || !job.bundle) {
      throw new Error("bundle already claimed or none produced");
    }
    const bundle = job.bundle;
    updateDemoState((s) => ({
      ...s,
      jobs: { ...s.jobs, [input.jobId]: { ...job, bundle: null } },
    }));
    return bundle;
  },
};

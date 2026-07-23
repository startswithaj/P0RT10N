import type { McClient, McClientFactory, S3Credential } from "../minio/mc.ts";
import type { ContainerRunSpec } from "../runtime/runtime.ts";
import type {
  CommandResult,
  CommandRunner,
  TempFiles,
} from "../lib/CommandRunner.ts";
import { McShellClient } from "../minio/McShellClient.ts";
import { Env } from "../lib/Env.ts";
import type { FetchLike } from "../tailscale/TailscaleHttpApi.ts";
import type {
  ContainerHandle,
  ContainerRuntime,
  ContainerState,
  InstanceHealth,
  InstanceRuntime,
  InstanceSpec,
} from "../runtime/runtime.ts";
import type { TailnetNode, TailscaleApi } from "../tailscale/tailscale.ts";
import type { UserInviteApi } from "../tailscale/userInvite.ts";
import { TailscaleUserInviteApi } from "../tailscale/TailscaleUserInviteApi.ts";
import type {
  FriendNaming,
  FriendProvisionContext,
  InstanceReservation,
  ProvisioningConfig,
  ProvisioningRepo,
} from "../provisioning/deps.ts";
import { ProvisioningService } from "../provisioning/ProvisioningService.ts";
import type { Logger } from "../services/types.ts";
import type { AddFriendInput } from "@p0rt1on/shared/domain";

// ============================================================================
// Central test mocks. Every mock records into a shared `Calls` log so tests can
// assert ordering across deps. Import these; do not redefine mocks inline.
// ============================================================================

/** Ordered log of operations performed across all mocked deps. */
export type Calls = string[];

export function noopLogger(): Logger {
  const logger: Logger = {
    info: () => {},
    warn: () => {},
    error: () => {},
    debug: () => {},
    child: () => logger,
  };
  return logger;
}

/** Logger that records warn messages, for asserting log-backstop behaviour. */
export function recordingLogger(): { logger: Logger; warns: string[] } {
  const warns: string[] = [];
  const logger: Logger = {
    ...noopLogger(),
    warn: (msg) => warns.push(msg),
    child: () => logger,
  };
  return { logger, warns };
}

export const TEST_CONFIG: ProvisioningConfig = {
  instanceImage: "p0rt1on-instance:pinned",
  instanceAddressing: "host",
  portRange: { min: 9000, max: 9100 },
  sharedInstanceName: "pool",
  tailnetDomain: "tailnet.ts.net",
  serveMode: "https",
  serveNodeTag: "tag:p0rt1on-serve",
  aclMode: "auto",
  auditWebhookUrl: "http://manager/internal/minio-events",
  auditWebhookToken: "tok",
};

/** An Env backed by a fixed map (master key set so requireMasterKey passes). */
export function testEnv(overrides: Record<string, string> = {}): Env {
  const base: Record<string, string> = {
    P0RT1ON_MASTER_KEY: "test-master-key",
    P0RT1ON_TAILSCALE_OAUTH_CLIENT_SECRET: "test-oauth-secret",
    P0RT1ON_TAILSCALE_TAILNET_DOMAIN: "tailnet.ts.net",
    // Required on the default (tailscale) backend — see Env.tagOwner.
    P0RT1ON_TAILSCALE_TAG_OWNER: "tag:p0rt1on",
    // Required on the default (docker) runtime — the pantry host path.
    P0RT1ON_PANTRY: "/srv/p0rt1on",
    ...overrides,
  };
  return new Env({ get: (k) => base[k] });
}

export const TEST_CRED: S3Credential = {
  accessKeyId: "AKIATEST",
  secretKey: "secret123",
};

/** One recorded subprocess invocation. */
export interface RecordedCommand {
  command: string;
  args: string[];
  env?: Record<string, string>;
}

/**
 * Fake CommandRunner: records each invocation and returns `respond(args)`
 * (default: success, empty output). Use it to assert the exact `mc` args built
 * and to drive parsing/error paths without a real subprocess.
 */
export function fakeRunner(
  recorded: RecordedCommand[],
  respond: (args: string[]) => CommandResult = () => ({
    code: 0,
    stdout: "",
    stderr: "",
  }),
): CommandRunner {
  return {
    run: (command, args, env) => {
      recorded.push({ command, args, env });
      return Promise.resolve(respond(args));
    },
  };
}

/** A successful CommandResult with optional stdout. */
export function cmdOk(stdout = ""): CommandResult {
  return { code: 0, stdout, stderr: "" };
}

/** Runner respond: `inspect` fails (container absent), any other cmd succeeds. */
export function respondAbsentInspect(args: string[]): CommandResult {
  return args[0] === "inspect"
    ? { code: 1, stdout: "", stderr: "no such object" }
    : cmdOk("newid\n");
}

export const INSTANCE_SPEC: InstanceSpec = {
  name: "alice",
  image: "p0rt1on-instance:x",
  tag: "tag:p0rt1on-serve",
  minioPort: 9100,
  rootCred: TEST_CRED,
  tsAuthKey: "tskey-serve-secret",
};

/** Docker-level run spec — what DockerInstanceRuntime derives from the above. */
export const CONTAINER_RUN_SPEC: ContainerRunSpec = {
  name: "p0rt1on-instance-alice",
  image: "p0rt1on-instance:x",
  tsHostname: "alice",
  tag: "tag:p0rt1on-serve",
  minioPort: 9100,
  dataSource: "p0rt1on-data-alice",
  stateSource: "p0rt1on-tsstate-alice",
  rootCredSecretRef: "/run/secrets/minio-alice.env",
  network: "p0rt1on-net",
  // Network addressing (how it actually ships): the manager reaches MinIO by
  // container name, so no host port is published. Host mode is the explicit
  // opt-in — see the host-publish test.
  publishHostPort: false,
};

/** One recorded HTTP request. */
export interface RecordedRequest {
  url: string;
  method: string;
  body?: string;
  headers: Record<string, string>;
}

/**
 * Fake fetch: records each request and returns `handler(req)` as a Response.
 * `json` is serialized into the body; default status 200. `headers` on the
 * handler result become response headers (e.g. an ETag).
 */
export function fakeFetch(
  recorded: RecordedRequest[],
  handler: (
    req: RecordedRequest,
  ) => { status?: number; json?: unknown; headers?: Record<string, string> },
): FetchLike {
  return (input, init) => {
    const req: RecordedRequest = {
      url: String(input),
      method: init?.method ?? "GET",
      body: init?.body ? String(init.body) : undefined,
      headers: init?.headers
        ? Object.fromEntries(new Headers(init.headers))
        : {},
    };
    recorded.push(req);
    const r = handler(req);
    const status = r.status ?? 200;
    return Promise.resolve(
      new Response(responseBody(status, r.json), {
        status,
        headers: r.headers,
      }),
    );
  };
}

/** 204/205/304 must have a null body; otherwise serialize `json` (or ""). */
function responseBody(status: number, json: unknown): string | null {
  if (status === 204 || status === 205 || status === 304) return null;
  return json !== undefined ? JSON.stringify(json) : "";
}

/** Fake TempFiles: records written content, returns a fixed path. */
export function fakeTempFiles(written: string[]): TempFiles {
  return {
    write: (content) => {
      written.push(content);
      return Promise.resolve("/fake/policy.json");
    },
    remove: () => Promise.resolve(),
  };
}

/** An McShellClient (alias "alice") wired to fake runner + temp files. */
export function buildMcShellClient(
  recorded: RecordedCommand[],
  respond?: (args: string[]) => CommandResult,
  written: string[] = [],
  readyDelayMs = 1, // fast `mc ready` retries — no real 500ms sleeps in tests
): McShellClient {
  return new McShellClient(
    { alias: "alice", minioPort: 9100 },
    TEST_CRED,
    "http://127.0.0.1:9100",
    fakeRunner(recorded, respond),
    fakeTempFiles(written),
    "mc",
    readyDelayMs,
  );
}

export function mockMcClient(calls: Calls): McClient {
  const note = (m: string) => () => {
    calls.push(`mc:${m}`);
    return Promise.resolve();
  };

  return {
    target: { alias: "alias", minioPort: 9100 },
    makeBucketWithLock: note("makeBucketWithLock"),
    removeBucket: note("removeBucket"),
    setDefaultRetention: note("setDefaultRetention"),
    setHardQuota: note("setHardQuota"),
    du: () => Promise.resolve({ bytesUsed: 0, objectCount: 0 }),
    createUser: note("createUser"),
    putBucketScopedPolicy: note("putBucketScopedPolicy"),
    attachPolicy: note("attachPolicy"),
    removePolicy: note("removePolicy"),
    disableUser: note("disableUser"),
    enableUser: note("enableUser"),
    removeUser: note("removeUser"),
    listUsers: () => {
      calls.push("mc:listUsers");
      return Promise.resolve([]);
    },
    setAuditWebhook: note("setAuditWebhook"),
    trace: async function* () {/* no events */},
  };
}

export function mockMcFactory(mc: McClient): McClientFactory {
  return {
    forInstance: () => mc,
  };
}

export function mockTailscaleApi(
  calls: Calls,
  nodes: TailnetNode[] = [],
): TailscaleApi {
  return {
    mintAuthKey: (opts) => {
      calls.push(`ts:mintAuthKey:${opts.tag}`);
      return Promise.resolve({
        key: `tskey-${opts.tag}`,
        keyId: "kid",
        tag: opts.tag,
        expiresAt: "2099-01-01T00:00:00Z",
      });
    },
    revokeAuthKey: (keyId) => {
      calls.push(`ts:revokeAuthKey:${keyId}`);
      return Promise.resolve();
    },
    nodesByTag: () => Promise.resolve(nodes),
    isNodeOnline: () => Promise.resolve(true),
    hasJoined: () => Promise.resolve(false),
    nodeIpv4: () => Promise.resolve("100.64.0.1"),
    deleteNode: (id) => {
      calls.push(`ts:deleteNode:${id}`);
      return Promise.resolve();
    },
    ensureFriendAcl: () => {
      calls.push("ts:ensureFriendAcl");
      return Promise.resolve();
    },
    removeFriendAcl: () => {
      calls.push("ts:removeFriendAcl");
      return Promise.resolve();
    },
  };
}

/** UserInviteApi mock: records each op into `calls`; `configured` defaults true.
 * Override any method (e.g. findUserByEmail returning a member) via `overrides`. */
export function mockUserInviteApi(
  calls: Calls,
  overrides: Partial<UserInviteApi> = {},
): UserInviteApi {
  return {
    configured: true,
    createUserInvite: (email) => {
      calls.push(`invite:create:${email}`);
      return Promise.resolve({
        id: "inv1",
        email,
        inviteUrl: "https://login.tailscale.com/uinv/inv1",
        lastEmailSentAt: null,
      });
    },
    getUserInvite: (id) => {
      calls.push(`invite:get:${id}`);
      return Promise.resolve(null);
    },
    resendUserInvite: (id) => {
      calls.push(`invite:resend:${id}`);
      return Promise.resolve();
    },
    deleteUserInvite: (id) => {
      calls.push(`invite:deleteInvite:${id}`);
      return Promise.resolve();
    },
    findUserByEmail: (email) => {
      calls.push(`invite:findUser:${email}`);
      return Promise.resolve(null);
    },
    deleteUser: (userId) => {
      calls.push(`invite:deleteUser:${userId}`);
      return Promise.resolve();
    },
    ...overrides,
  };
}

/** ContainerRuntime mock for reconcile tests: canned list, health per name. */
export function mockContainerRuntime(
  calls: Calls,
  opts: {
    containers?: ContainerHandle[];
    healthFor?: (name: string) => InstanceHealth;
    listError?: Error;
  } = {},
): ContainerRuntime {
  return {
    ensureInstance: (spec) => {
      calls.push(`docker:ensureInstance:${spec.name}`);
      return Promise.resolve({ name: spec.name, id: "id", state: "running" });
    },
    ensureStarted: (name) => {
      calls.push(`docker:start:${name}`);
      return Promise.resolve();
    },
    status: () => Promise.resolve("running"),
    health: (name) => Promise.resolve(opts.healthFor?.(name) ?? "healthy"),
    diagnose: (name) =>
      Promise.resolve({
        name,
        state: "running",
        health: "healthy",
        healthReason: null,
        exitCode: null,
        exitError: null,
        recentLogs: "",
      }),
    stop: () => Promise.resolve(),
    remove: (name) => {
      calls.push(`docker:remove:${name}`);
      return Promise.resolve();
    },
    removeVolumes: () => Promise.resolve(),
    list: () =>
      opts.listError
        ? Promise.reject(opts.listError)
        : Promise.resolve(opts.containers ?? []),
  };
}

/** An InstanceRuntime.diagnoseInstance that reports the container as absent. */
export const absentInstance = (name: string) =>
  Promise.resolve({
    name,
    state: "absent" as const,
    health: "unknown" as const,
    healthReason: null,
    exitCode: null,
    exitError: null,
    recentLogs: "",
  });

export function mockInstanceRuntime(
  calls: Calls,
  opts: {
    /** listInstances result (instance names + states). */
    instances?: { name: string; state: ContainerState }[];
    healthFor?: (name: string) => InstanceHealth;
    /** hasData result per instance; default true (data present). */
    hasDataFor?: (name: string) => boolean;
    listError?: Error;
  } = {},
): InstanceRuntime {
  return {
    ensureInstance: (spec) => {
      calls.push("runtime:ensureInstance");
      return Promise.resolve({ name: spec.name, id: "id", state: "running" });
    },
    adminEndpoint: (_name, minioPort) => `http://127.0.0.1:${minioPort}`,
    instanceHealth: (name) =>
      Promise.resolve(opts.healthFor?.(name) ?? "healthy"),
    hasData: (name) => Promise.resolve(opts.hasDataFor?.(name) ?? true),
    listInstances: () =>
      opts.listError
        ? Promise.reject(opts.listError)
        : Promise.resolve(opts.instances ?? []),
    ensureRunning: (name) => {
      calls.push(`runtime:ensureRunning:${name}`);
      return Promise.resolve();
    },
    waitUntilHealthy: () => {
      calls.push("runtime:waitUntilHealthy");
      return Promise.resolve();
    },
    diagnoseInstance: (name) =>
      Promise.resolve({
        name,
        state: "running",
        health: "healthy",
        healthReason: null,
        exitCode: null,
        exitError: null,
        recentLogs: "",
      }),
    stopInstance: () => Promise.resolve(),
    removeInstance: () => {
      calls.push("runtime:removeInstance");
      return Promise.resolve();
    },
  };
}

export function mockProvisioningRepo(
  calls: Calls,
  reservation: InstanceReservation,
  overrides: Partial<ProvisioningRepo> = {},
): ProvisioningRepo {
  return {
    reserveFriend: (_input: AddFriendInput, _naming: FriendNaming) => {
      calls.push("repo:reserveFriend");
      return Promise.resolve(reservation);
    },
    recordAccessKey: () => {
      calls.push("repo:recordAccessKey");
      return Promise.resolve();
    },
    recordTsKeyId: (_friendId, tsKeyId) => {
      calls.push(`repo:recordTsKeyId:${tsKeyId}`);
      return Promise.resolve();
    },
    recordInvite: (_friendId, invite) => {
      calls.push(`repo:recordInvite:${invite.status}`);
      return Promise.resolve();
    },
    recordServeNodeId: (_instanceId, serveNodeId) => {
      calls.push(`repo:recordServeNodeId:${serveNodeId}`);
      return Promise.resolve();
    },
    setQuota: () => {
      calls.push("repo:setQuota");
      return Promise.resolve();
    },
    setStatus: () => {
      calls.push("repo:setStatus");
      return Promise.resolve();
    },
    activate: () => {
      calls.push("repo:activate");
      return Promise.resolve();
    },
    markFailed: () => {
      calls.push("repo:markFailed");
      return Promise.resolve();
    },
    context: () => Promise.reject(new Error("context not stubbed")),
    otherFriendsWithInviteEmail: () => Promise.resolve(0),
    friendsOnInstance: () => Promise.resolve(0),
    liveFriendTagsOnInstance: () => Promise.resolve([]),
    markInstanceReaping: (_instanceId, opts) => {
      calls.push(`repo:markInstanceReaping:requireEmpty=${opts.requireEmpty}`);
      return Promise.resolve(true);
    },
    failedFriendIds: () => Promise.resolve([]),
    failStaleProvisioning: () => {
      calls.push("repo:failStaleProvisioning");
      return Promise.resolve([]);
    },
    liveInstances: () => Promise.resolve([]),
    failInstanceMissing: (id) => {
      calls.push(`repo:failInstanceMissing:${id}`);
      return Promise.resolve(0);
    },
    failedInstances: () => Promise.resolve([]),
    deleteFriend: () => {
      calls.push("repo:deleteFriend");
      return Promise.resolve();
    },
    deleteInstance: () => {
      calls.push("repo:deleteInstance");
      return Promise.resolve();
    },
    audit: (_friendId, action) => {
      calls.push(`repo:audit:${action}`);
      return Promise.resolve();
    },
    ...overrides,
  };
}

// ---- ProvisioningService test kit (fixtures + a fully-mocked builder) ----
// Lives here (not in the *.test.ts) because the repo's no-test-globals rule
// bans module-level declarations in test files.

export const DEDICATED_RES: InstanceReservation = {
  friendId: 1,
  instanceId: 10,
  alias: "alias",
  hostPort: 9000,
  // reserveFriend echoes buildNaming's tsHostname, which is p0rt1on-<name>.
  tsHostname: "p0rt1on-alice",
  instanceExisted: false,
};

export const ADD_INPUT: AddFriendInput = {
  name: "alice",
  quotaBytes: 1024,
  retentionDays: 30,
  isolationMode: "dedicated",
  lockMode: "GOVERNANCE",
  enrollment: { mode: "authKey" },
};

export const INVITE_INPUT: AddFriendInput = {
  ...ADD_INPUT,
  enrollment: { mode: "invite", email: "bob@example.com" },
};

/** An invite-enrolled friend context (offboard/status tests). */
export const INVITE_CTX: FriendProvisionContext = {
  friendId: 1,
  name: "alice",
  isolationMode: "dedicated",
  bucket: "alice",
  s3AccessKeyId: "AKIAOLD",
  tsKeyId: null,
  nodeTag: "tag:p0rt1on-friend-alice",
  enrollmentMode: "invite",
  inviteEmail: "bob@example.com",
  inviteId: "inv1",
  lockMode: "GOVERNANCE",
  lockRetentionDays: 30,
  instanceId: 10,
  instanceName: "p0rt1on-minio-alice",
  alias: "alias",
  tsHostname: "alice",
  serveNodeId: null,
  minioPort: 9100,
};

export const CTX: FriendProvisionContext = {
  friendId: 1,
  name: "alice",
  isolationMode: "dedicated",
  bucket: "alice",
  s3AccessKeyId: "AKIAOLD",
  tsKeyId: "kid-old",
  nodeTag: "tag:p0rt1on-friend-alice",
  enrollmentMode: "authKey",
  inviteEmail: null,
  inviteId: null,
  lockMode: "GOVERNANCE",
  lockRetentionDays: 30,
  instanceId: 10,
  instanceName: "p0rt1on-minio-alice",
  alias: "alias",
  tsHostname: "alice",
  serveNodeId: null,
  minioPort: 9100,
};

/** Overridable parts for a ProvisioningService under test. */
export interface ProvisioningParts {
  repo?: Partial<ProvisioningRepo>;
  runtime?: Partial<InstanceRuntime>;
  /** Override individual mc operations (e.g. inject teardown failures). */
  mc?: Partial<McClient>;
  smoke?: () => Promise<void>;
  nodes?: TailnetNode[];
  /** Override individual tailscale operations (e.g. inject revoke failures). */
  tailscale?: Partial<TailscaleApi>;
  /** Invite API; default is unconfigured (authKey-only flow). */
  userInvite?: UserInviteApi;
  config?: Partial<ProvisioningConfig>;
}

/** A ProvisioningService wired to all mocks, recording into `calls`. */
export function buildProvisioningService(
  calls: Calls,
  reservation: InstanceReservation,
  parts: ProvisioningParts = {},
): ProvisioningService {
  return new ProvisioningService(
    { ...TEST_CONFIG, ...parts.config },
    mockProvisioningRepo(calls, reservation, parts.repo),
    mockMcFactory({ ...mockMcClient(calls), ...parts.mc }),
    { ...mockInstanceRuntime(calls), ...parts.runtime },
    { ...mockTailscaleApi(calls, parts.nodes), ...parts.tailscale },
    parts.userInvite ?? new TailscaleUserInviteApi({}),
    {
      generateS3Credential: () => TEST_CRED,
      rootCredentialFor: () => TEST_CRED,
    },
    {
      run: parts.smoke ?? (() => {
        calls.push("smoke:run");
        return Promise.resolve();
      }),
    },
    noopLogger(),
  );
}

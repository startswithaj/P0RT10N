import { describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import {
  buildMcShellClient as client,
  fakeRunner,
  fakeTempFiles,
  type RecordedCommand,
} from "../test-helpers/mocks.ts";
import { McShellClient } from "./McShellClient.ts";

describe("McShellClient arg-building", () => {
  it("makeBucketWithLock issues `mc mb --with-lock alias/bucket`", async () => {
    const cmds: RecordedCommand[] = [];
    await client(cmds).makeBucketWithLock("backup");
    expect(cmds[0].command).toBe("mc");
    expect(cmds[0].args).toEqual(["mb", "--with-lock", "alice/backup"]);
  });

  it("every call carries the root cred via MC_HOST env, never argv", async () => {
    const cmds: RecordedCommand[] = [];
    const c = client(cmds);
    await c.makeBucketWithLock("backup");
    await c.du("backup");
    await c.listUsers();
    cmds.forEach((cmd) => {
      expect(cmd.env).toEqual({
        MC_HOST_alice: "http://AKIATEST:secret123@127.0.0.1:9100",
      });
      expect(cmd.args.join(" ")).not.toContain("secret123");
      expect(cmd.args[0]).not.toBe("alias");
    });
  });

  it("MC_HOST URL-encodes credentials with URL-significant chars", async () => {
    const cmds: RecordedCommand[] = [];
    const c = new McShellClient(
      { alias: "alice", minioPort: 9100 },
      { accessKeyId: "AK/1", secretKey: "s:e@c/r?t#" },
      "http://127.0.0.1:9100",
      fakeRunner(cmds),
      fakeTempFiles([]),
      "mc",
    );
    await c.du("backup");
    expect(cmds[0].env).toEqual({
      MC_HOST_alice: "http://AK%2F1:s%3Ae%40c%2Fr%3Ft%23@127.0.0.1:9100",
    });
  });

  it("failure never leaks the root cred — raw or URL-encoded", async () => {
    const failing = new McShellClient(
      { alias: "alice", minioPort: 9100 },
      { accessKeyId: "AK", secretKey: "r00t/s3cr3t" },
      "http://127.0.0.1:9100",
      fakeRunner([], () => ({
        code: 1,
        stdout: "",
        stderr:
          "cannot reach http://AK:r00t%2Fs3cr3t@127.0.0.1:9100 r00t/s3cr3t",
      })),
      fakeTempFiles([]),
      "mc",
    );
    const err = await failing.du("backup")
      .then(() => null, (e: Error) => e.message);
    expect(err).not.toContain("r00t/s3cr3t");
    expect(err).not.toContain("r00t%2Fs3cr3t");
  });

  it("setDefaultRetention passes mode + Nd + path", async () => {
    const cmds: RecordedCommand[] = [];
    await client(cmds).setDefaultRetention("backup", "GOVERNANCE", 30);
    expect(cmds[0].args).toEqual([
      "retention",
      "set",
      "--default",
      "GOVERNANCE",
      "30d",
      "alice/backup",
    ]);
  });

  it("setHardQuota passes the byte count", async () => {
    const cmds: RecordedCommand[] = [];
    await client(cmds).setHardQuota("backup", 1048576);
    expect(cmds[0].args).toEqual([
      "quota",
      "set",
      "alice/backup",
      "--size",
      "1048576",
    ]);
  });

  it("createUser passes access key id + secret", async () => {
    const cmds: RecordedCommand[] = [];
    await client(cmds).createUser({ accessKeyId: "AK", secretKey: "SK" });
    expect(cmds[0].args).toEqual(
      ["admin", "user", "add", "--", "alice", "AK", "SK"],
    );
  });

  it("attachPolicy targets the user", async () => {
    const cmds: RecordedCommand[] = [];
    await client(cmds).attachPolicy("AK", "backup");
    expect(cmds[0].args).toEqual([
      "admin",
      "policy",
      "attach",
      "alice",
      "backup",
      "--user",
      "AK",
    ]);
  });

  it("removePolicy issues admin policy rm and tolerates an absent policy", async () => {
    const cmds: RecordedCommand[] = [];
    await client(cmds).removePolicy("backup");
    expect(cmds[0].args).toEqual(["admin", "policy", "rm", "alice", "backup"]);

    const respond = () => ({
      code: 1,
      stdout: "",
      stderr:
        "mc: <ERROR> Unable to remove policy. Policy `backup` does not exist.",
    });

    await expect(client([], respond).removePolicy("backup")).resolves
      .toBeUndefined();
  });

  it("disable/enable/removeUser issue the matching admin user verb", async () => {
    const cmds: RecordedCommand[] = [];
    const c = client(cmds);
    await c.disableUser("AK");
    await c.enableUser("AK");
    await c.removeUser("AK");
    expect(cmds.map((cmd) => cmd.args[2])).toEqual([
      "disable",
      "enable",
      "remove",
    ]);
    expect(cmds[0].args).toEqual(["admin", "user", "disable", "alice", "AK"]);
  });

  it("setAuditWebhook configures, restarts, then waits for ready", async () => {
    const cmds: RecordedCommand[] = [];
    await client(cmds).setAuditWebhook("http://m/audit", "tok");
    expect(cmds[0].args.slice(0, 5)).toEqual([
      "admin",
      "config",
      "set",
      "alice",
      "audit_webhook:p0rt1on",
    ]);
    // MinIO sends auth_token verbatim as the Authorization header, so the
    // Bearer scheme must be baked in here, quoted for mc's KV parser.
    expect(cmds[0].args[6]).toBe('auth_token="Bearer tok"');
    expect(cmds[1].args).toEqual(
      ["admin", "service", "restart", "--json", "alice"],
    );
    // The restart drops connections, so "configured" must mean "serving
    // again"; the next mc call must not land in the restart window.
    expect(cmds[2].args).toEqual(["ready", "alice"]);
  });

  it("setAuditWebhook retries `ready` until MinIO answers again", async () => {
    const cmds: RecordedCommand[] = [];
    const readyFailures = { left: 2 };
    await client(cmds, (args) => {
      if (args[0] === "ready" && readyFailures.left > 0) {
        readyFailures.left -= 1;
        return { code: 1, stdout: "", stderr: "connection refused" };
      }
      return { code: 0, stdout: "", stderr: "" };
    }).setAuditWebhook("http://m/audit", "tok");
    expect(cmds.filter((c) => c.args[0] === "ready").length).toBe(3);
  });

  it("setAuditWebhook fails loudly when MinIO never comes back", async () => {
    const failing = client(
      [],
      (args) =>
        args[0] === "ready"
          ? { code: 1, stdout: "", stderr: "connection refused" }
          : { code: 0, stdout: "", stderr: "" },
    );
    await expect(failing.setAuditWebhook("http://m/audit", "tok"))
      .rejects.toThrow("did not come back after restart");
  });

  it("createUser failure never leaks the secret key in the error", async () => {
    // The secret sits after `--`, so argv is structurally omitted from
    // errors, and it is also declared for masking as a backup.
    const failing = client([], () => ({
      code: 1,
      stdout: "",
      stderr: "unable to add user with secret SK-s3cr3t",
    }));
    const err = await failing
      .createUser({ accessKeyId: "AK", secretKey: "SK-s3cr3t" })
      .then(() => null, (e: Error) => e.message);
    expect(err).toContain("admin user add");
    expect(err).not.toContain("SK-s3cr3t");
  });

  it("args after -- are omitted from errors even with no declared secrets", async () => {
    const failing = client([], () => ({ code: 1, stdout: "", stderr: "boom" }));
    const err = await failing
      .createUser({ accessKeyId: "AK-visible-id", secretKey: "SK" })
      .then(() => null, (e: Error) => e.message);
    expect(err).toContain("…<3 args>");
    expect(err).not.toContain("AK-visible-id");
  });

  it("setAuditWebhook failure never leaks the token in the error", async () => {
    const cmds: RecordedCommand[] = [];
    // Fail with the token in BOTH places it can appear: the echoed argv and
    // mc's own stderr.
    const failing = client(cmds, () => ({
      code: 1,
      stdout: "",
      stderr: "unable to set auth_token=Bearer s3cr3t-tok",
    }));
    const err = await failing.setAuditWebhook("http://m/audit", "s3cr3t-tok")
      .then(() => null, (e: Error) => e.message);
    expect(err).toContain("«redacted»");
    expect(err).not.toContain("s3cr3t-tok");
  });
});

describe("McShellClient policy", () => {
  it("writes a bucket-scoped policy that denies lock bypass, then creates it", async () => {
    const cmds: RecordedCommand[] = [];
    const written: string[] = [];
    await client(cmds, undefined, written).putBucketScopedPolicy(
      "backup",
      "backup",
    );

    expect(written[0]).toContain("s3:BypassGovernanceRetention");
    expect(written[0]).toContain('"Effect":"Deny"');
    expect(cmds[0].args).toEqual([
      "admin",
      "policy",
      "create",
      "alice",
      "backup",
      "/fake/policy.json",
    ]);
  });
});

describe("McShellClient parsing + errors", () => {
  it("du parses size + objects from the last JSON line", async () => {
    const cmds: RecordedCommand[] = [];

    const respond = () => ({
      code: 0,
      stdout: '{"status":"success","size":2048,"objects":7}\n',
      stderr: "",
    });

    const result = await client(cmds, respond).du("backup");
    expect(result).toEqual({ bytesUsed: 2048, objectCount: 7 });
  });

  it("throws with stderr on non-zero exit", async () => {
    const cmds: RecordedCommand[] = [];
    const respond = () => ({ code: 1, stdout: "", stderr: "bucket exists" });
    await expect(client(cmds, respond).makeBucketWithLock("backup"))
      .rejects.toThrow("bucket exists");
  });

  it("removeBucket purges locked versions with --bypass before rb", async () => {
    // `rb --force` cannot delete GOVERNANCE-locked versions, which every
    // active friend has, so the bypass purge must run before the removal.
    const cmds: RecordedCommand[] = [];
    await client(cmds).removeBucket("backup");
    expect(cmds.map((c) => c.args)).toEqual([
      [
        "rm",
        "--recursive",
        "--versions",
        "--force",
        "--bypass",
        "alice/backup",
      ],
      ["rb", "--force", "alice/backup"],
    ]);
  });

  // Teardown idempotency: "already absent" (or a name that could never exist,
  // like a bucket below MinIO's 3-char minimum) is success, not an error.
  it("removeBucket succeeds when the bucket does not exist", async () => {
    const respond = () => ({
      code: 1,
      stdout: "",
      stderr:
        "mc: <ERROR> Unable to validate target `alice/backup`. Bucket `backup` does not exist.",
    });

    await expect(client([], respond).removeBucket("backup")).resolves
      .toBeUndefined();
  });

  it("removeBucket succeeds when the bucket name is too short to exist", async () => {
    const respond = () => ({
      code: 1,
      stdout: "",
      stderr:
        "mc: <ERROR> Unable to validate target `alice/do`. Bucket name cannot be shorter than 3 characters",
    });

    await expect(client([], respond).removeBucket("do")).resolves
      .toBeUndefined();
  });

  it("removeBucket still rethrows unrelated errors", async () => {
    const respond = () => ({ code: 1, stdout: "", stderr: "access denied" });
    await expect(client([], respond).removeBucket("backup"))
      .rejects.toThrow("access denied");
  });

  it("removeUser succeeds when the user does not exist", async () => {
    const respond = () => ({
      code: 1,
      stdout: "",
      stderr: "mc: <ERROR> The specified user does not exist.",
    });

    await expect(client([], respond).removeUser("AK")).resolves.toBeUndefined();
  });

  it("listUsers parses one JSON line per user and splits attached policies", async () => {
    const cmds: RecordedCommand[] = [];

    const respond = () => ({
      code: 0,
      stdout: [
        '{"status":"success","accessKey":"AKIAONE","policyName":"alice","userStatus":"enabled"}',
        '{"status":"success","accessKey":"AKIATWO","policyName":"alice,extra","userStatus":"enabled"}',
        '{"status":"success","accessKey":"AKIABARE","userStatus":"enabled"}',
      ].join("\n"),
      stderr: "",
    });

    const users = await client(cmds, respond).listUsers();
    expect(cmds[0].args).toEqual(["admin", "user", "list", "--json", "alice"]);
    expect(users).toEqual([
      { accessKeyId: "AKIAONE", policies: ["alice"] },
      { accessKeyId: "AKIATWO", policies: ["alice", "extra"] },
      { accessKeyId: "AKIABARE", policies: [] },
    ]);
  });

  it("listUsers returns empty for no users (empty output)", async () => {
    const users = await client([], () => ({ code: 0, stdout: "", stderr: "" }))
      .listUsers();
    expect(users).toEqual([]);
  });

  it("trace throws NOT_IMPLEMENTED on iteration", () => {
    const iterable = client([]).trace(new AbortController().signal);
    expect(() => iterable[Symbol.asyncIterator]()).toThrow("not implemented");
  });
});

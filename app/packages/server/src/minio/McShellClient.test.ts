import { describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import {
  buildMcShellClient as client,
  type RecordedCommand,
} from "../test-helpers/mocks.ts";

describe("McShellClient arg-building", () => {
  it("makeBucketWithLock issues `mc mb --with-lock alias/bucket`", async () => {
    const cmds: RecordedCommand[] = [];
    await client(cmds).makeBucketWithLock("backup");
    expect(cmds[0]).toEqual({
      command: "mc",
      args: ["mb", "--with-lock", "alice/backup"],
    });
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

  it("removeBucket force-deletes", async () => {
    const cmds: RecordedCommand[] = [];
    await client(cmds).removeBucket("backup");
    expect(cmds[0].args).toEqual(["rb", "--force", "alice/backup"]);
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

  it("setAuditWebhook configures then restarts", async () => {
    const cmds: RecordedCommand[] = [];
    await client(cmds).setAuditWebhook("http://m/audit", "tok");
    expect(cmds[0].args.slice(0, 5)).toEqual([
      "admin",
      "config",
      "set",
      "alice",
      "audit_webhook:p0rt1on",
    ]);
    expect(cmds[1].args).toEqual(
      ["admin", "service", "restart", "--json", "alice"],
    );
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

  it("trace throws NOT_IMPLEMENTED on iteration", () => {
    const iterable = client([]).trace(new AbortController().signal);
    expect(() => iterable[Symbol.asyncIterator]()).toThrow("not implemented");
  });
});

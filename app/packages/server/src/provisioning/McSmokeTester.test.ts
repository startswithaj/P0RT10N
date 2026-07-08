import { describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { McSmokeTester } from "./McSmokeTester.ts";
import type { SmokeTestParams } from "./deps.ts";
import {
  cmdOk,
  fakeRunner,
  fakeTempFiles,
  type RecordedCommand,
} from "../test-helpers/mocks.ts";

describe("McSmokeTester", () => {
  const PARAMS: SmokeTestParams = {
    endpoint: "http://127.0.0.1:9100",
    region: "us-east-1",
    bucket: "alice",
    cred: { accessKeyId: "AK", secretKey: "SK" },
  };

  // `cat` echoes back the most recently written temp-file content (the token),
  // so the GET-matches check passes; everything else succeeds.
  const happy = (written: string[]) => (args: string[]) =>
    args[0] === "cat" ? cmdOk(written[0]) : cmdOk();

  it("runs cp → cat → rm with the friend's creds in MC_HOST env, never argv", async () => {
    const cmds: RecordedCommand[] = [];
    const written: string[] = [];
    await new McSmokeTester(
      fakeRunner(cmds, happy(written)),
      fakeTempFiles(written),
    )
      .run(PARAMS);

    expect(cmds.map((c) => c.args[0])).toEqual(["cp", "cat", "rm"]);
    cmds.forEach((cmd) => {
      // The friend's creds ride a throwaway MC_HOST env var; argv stays
      // secret-free.
      const env = cmd.env ?? {};
      const hostVar = Object.keys(env).find((k) =>
        k.startsWith("MC_HOST_p0rt1on-smoke-")
      );
      expect(hostVar).toBeDefined();
      expect(env[hostVar as string]).toBe("http://AK:SK@127.0.0.1:9100");
      expect(cmd.args.join(" ")).not.toContain("SK");
    });
    // cp targets the friend's bucket under the throwaway alias.
    expect(cmds[0].args[2]).toContain("/alice/");
  });

  it("failure never leaks the friend's secret in the error", async () => {
    const respond = (args: string[]) =>
      args[0] === "cp"
        ? { code: 1, stdout: "", stderr: "denied for http://AK:SK@host SK" }
        : cmdOk();
    const err = await new McSmokeTester(
      fakeRunner([], respond),
      fakeTempFiles([]),
    )
      .run(PARAMS)
      .then(() => null, (e: Error) => e.message);
    expect(err).toContain("smoke-test step");
    expect(err).not.toContain("SK");
  });

  it("throws when GET returns mismatched content", async () => {
    const respond = (args: string[]) =>
      args[0] === "cat" ? cmdOk("tampered") : cmdOk();
    await expect(
      new McSmokeTester(fakeRunner([], respond), fakeTempFiles([])).run(PARAMS),
    ).rejects.toThrow("unexpected content");
  });

  it("throws when a step fails (e.g. PutObject denied)", async () => {
    const respond = (args: string[]) =>
      args[0] === "cp"
        ? { code: 1, stdout: "", stderr: "Access Denied" }
        : cmdOk();
    await expect(
      new McSmokeTester(fakeRunner([], respond), fakeTempFiles([])).run(PARAMS),
    ).rejects.toThrow("Access Denied");
  });
});

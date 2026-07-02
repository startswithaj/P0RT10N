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

  it("runs alias set → cp → cat → rm → alias remove", async () => {
    const cmds: RecordedCommand[] = [];
    const written: string[] = [];
    await new McSmokeTester(
      fakeRunner(cmds, happy(written)),
      fakeTempFiles(written),
    )
      .run(PARAMS);

    const verbs = cmds.map((c) =>
      c.args[0] === "alias" ? `alias ${c.args[1]}` : c.args[0]
    );
    expect(verbs).toEqual(["alias set", "cp", "cat", "rm", "alias remove"]);
    // alias set uses the friend's own creds + endpoint.
    const set = cmds[0].args;
    expect(set.slice(-3)).toEqual(["http://127.0.0.1:9100", "AK", "SK"]);
    // cp / cat / rm all target the friend's bucket.
    expect(cmds[1].args[2]).toContain("/alice/");
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

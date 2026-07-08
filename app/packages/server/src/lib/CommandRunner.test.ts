import { describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { DenoCommandRunner, DenoTempFiles } from "./CommandRunner.ts";
import { McShellClientFactory } from "../minio/McShellClient.ts";
import {
  fakeRunner,
  fakeTempFiles,
  type RecordedCommand,
  TEST_CRED,
} from "../test-helpers/mocks.ts";

describe("DenoCommandRunner", () => {
  it("runs a real subprocess and captures stdout + exit code", async () => {
    const result = await new DenoCommandRunner().run("echo", ["hello"]);
    expect(result.code).toBe(0);
    expect(result.stdout.trim()).toBe("hello");
  });

  it("merges per-call env over the inherited environment", async () => {
    const result = await new DenoCommandRunner().run(
      "printenv",
      ["P0RT1ON_TEST_VAR"],
      { P0RT1ON_TEST_VAR: "from-env-param" },
    );
    expect(result.code).toBe(0);
    expect(result.stdout.trim()).toBe("from-env-param");
  });
});

describe("DenoTempFiles", () => {
  it("writes a file then removes it", async () => {
    const dir = "./.p0rt1on-test-tmp";
    const tmp = new DenoTempFiles(dir);
    const path = await tmp.write("policy-body");
    expect(await Deno.readTextFile(path)).toBe("policy-body");

    await tmp.remove(path);
    const after = await Deno.readTextFile(path).catch(() => "gone");
    expect(after).toBe("gone");

    await Deno.remove(dir, { recursive: true }).catch(() => {});
  });
});

describe("McShellClientFactory", () => {
  it("builds a client bound to the given instance alias", async () => {
    const cmds: RecordedCommand[] = [];
    const factory = new McShellClientFactory(
      fakeRunner(cmds),
      fakeTempFiles([]),
      { rootCredentialFor: () => TEST_CRED },
      (t) => `http://127.0.0.1:${t.minioPort}`,
      "mc",
    );
    await factory.forInstance({ alias: "zed", minioPort: 9007 })
      .makeBucketWithLock("b");
    expect(cmds[0].args).toEqual(["mb", "--with-lock", "zed/b"]);
    // The factory derives the cred and composes the endpoint into MC_HOST.
    expect(cmds[0].env).toEqual({
      MC_HOST_zed: "http://AKIATEST:secret123@127.0.0.1:9007",
    });
  });
});

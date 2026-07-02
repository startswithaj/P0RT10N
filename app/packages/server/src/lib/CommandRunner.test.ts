import { describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { DenoCommandRunner, DenoTempFiles } from "./CommandRunner.ts";
import { McShellClientFactory } from "../minio/McShellClient.ts";
import {
  fakeRunner,
  fakeTempFiles,
  type RecordedCommand,
} from "../test-helpers/mocks.ts";

describe("DenoCommandRunner", () => {
  it("runs a real subprocess and captures stdout + exit code", async () => {
    const result = await new DenoCommandRunner().run("echo", ["hello"]);
    expect(result.code).toBe(0);
    expect(result.stdout.trim()).toBe("hello");
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
      "mc",
    );
    await factory.forInstance({ alias: "zed" }).makeBucketWithLock("b");
    expect(cmds[0].args).toEqual(["mb", "--with-lock", "zed/b"]);
  });
});

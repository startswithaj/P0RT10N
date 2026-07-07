import { describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { recordingLogger } from "../test-helpers/mocks.ts";
import { loggedStream } from "./trpc.ts";

describe("loggedStream", () => {
  // Middleware can't see mid-stream throws (next() resolves when the generator
  // is CREATED), so loggedStream is the only thing standing between a streaming
  // bug and a silent server log — these tests pin that backstop.

  async function* throwing(): AsyncGenerator<string> {
    yield "a";
    throw new Error("boom");
  }

  async function* clean(): AsyncGenerator<number> {
    yield 1;
    yield 2;
  }

  it("logs a mid-stream throw before rethrowing", async () => {
    const { logger, warns } = recordingLogger();
    const gen = loggedStream(throwing(), logger, "jobs.progress");
    expect((await gen.next()).value).toBe("a");
    await expect(gen.next()).rejects.toThrow("boom");
    expect(warns).toContain("stream error");
  });

  it("passes a clean stream through without logging", async () => {
    const { logger, warns } = recordingLogger();
    expect(await Array.fromAsync(loggedStream(clean(), logger, "x")))
      .toEqual([1, 2]);
    expect(warns).toEqual([]);
  });
});

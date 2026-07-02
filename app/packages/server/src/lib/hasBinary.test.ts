import { describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { hasBinary } from "./hasBinary.ts";

describe("hasBinary", () => {
  it("returns true for a binary on PATH", () => {
    expect(hasBinary("deno")).toBe(true);
  });

  it("returns false for a missing binary", () => {
    expect(hasBinary("p0rt1on-definitely-not-real-xyz")).toBe(false);
  });
});

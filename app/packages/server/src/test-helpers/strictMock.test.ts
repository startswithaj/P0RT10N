import { describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { strictMock } from "./mocks.ts";

describe("strictMock", () => {
  it("returns stubbed members and throws on anything else, naming it", () => {
    const m = strictMock<{ a(): number; b(): number }>("Thing", {
      a: () => 1,
    });
    expect(m.a()).toBe(1);
    expect(() => m.b()).toThrow("Thing.b was accessed but not mocked");
  });

  it("stays awaitable: `then` reads as undefined rather than throwing", async () => {
    const m = strictMock<{ a(): number }>("Thing", { a: () => 1 });
    expect(await Promise.resolve(m)).toBe(m);
  });
});

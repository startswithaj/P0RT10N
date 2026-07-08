import { describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { maskSecrets, safeArgs } from "./redact.ts";

describe("redact", () => {
  it("maskSecrets masks every occurrence, including inside key=value", () => {
    const masked = maskSecrets(
      "set auth_token=tok-123 failed: unable to set auth_token=tok-123",
      ["tok-123"],
    );
    expect(masked).not.toContain("tok-123");
    expect(masked).toBe(
      "set auth_token=«redacted» failed: unable to set auth_token=«redacted»",
    );
  });

  it("maskSecrets ignores empty secrets (never mangles the message)", () => {
    expect(maskSecrets("abc", [""])).toBe("abc");
  });

  it("safeArgs omits everything after -- with a count placeholder", () => {
    expect(safeArgs(["admin", "user", "add", "--", "alias", "AK", "SK"]))
      .toBe("admin user add -- …<3 args>");
  });

  it("safeArgs leaves argv without -- unchanged", () => {
    expect(safeArgs(["rb", "--force", "alias/backup"]))
      .toBe("rb --force alias/backup");
  });
});

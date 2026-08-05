import { describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { maskEnvSecrets, maskSecrets, safeArgs } from "./redact.ts";

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

  it("maskEnvSecrets strips values for named env vars without knowing them in advance", () => {
    const masked = maskEnvSecrets(
      "boot failed\nMINIO_ROOT_PASSWORD=hunter2 TAILSCALE_AUTHKEY=tskey-abc123\nretrying",
      ["MINIO_ROOT_PASSWORD", "TAILSCALE_AUTHKEY"],
    );
    expect(masked).not.toContain("hunter2");
    expect(masked).not.toContain("tskey-abc123");
    expect(masked).toBe(
      "boot failed\nMINIO_ROOT_PASSWORD=«redacted» TAILSCALE_AUTHKEY=«redacted»\nretrying",
    );
  });

  it("maskEnvSecrets leaves unrelated text (including the var name alone) untouched", () => {
    expect(maskEnvSecrets("couldn't find key MINIO_ROOT_PASSWORD in Secret", [
      "MINIO_ROOT_PASSWORD",
    ])).toBe("couldn't find key MINIO_ROOT_PASSWORD in Secret");
  });
});

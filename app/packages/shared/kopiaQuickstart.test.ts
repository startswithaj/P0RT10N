import { describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { buildKopiaQuickstart, kopiaJoinLines } from "./kopiaQuickstart.ts";

describe("buildKopiaQuickstart docker alternative", () => {
  const opts = {
    endpoint: "https://alice.tailnet.ts.net",
    bucket: "alice",
    cred: { accessKeyId: "AK", secretKey: "SK" },
    retentionDays: 14,
  };

  it("appends a prefilled backup.env on create", () => {
    const snippet = buildKopiaQuickstart({
      ...opts,
      create: true,
      joinLines: kopiaJoinLines("tailscale up --authkey=tskey-x"),
      tsAuthKey: "tskey-x",
    });
    expect(snippet).toContain("p0rt1on-backup-client");
    expect(snippet).toContain("TAILSCALE_AUTHKEY=tskey-x");
    expect(snippet).toContain("S3_ENDPOINT=https://alice.tailnet.ts.net");
    expect(snippet).toContain("S3_BUCKET=alice");
    expect(snippet).toContain("S3_ACCESS_KEY_ID=AK");
    expect(snippet).toContain("S3_SECRET_ACCESS_KEY=SK");
    expect(snippet).toContain("RETENTION_DAYS=14");
  });

  it("uses a placeholder auth key for invite enrollment", () => {
    const snippet = buildKopiaQuickstart({ ...opts, create: true });
    expect(snippet).toContain("TAILSCALE_AUTHKEY=<your-tailscale-auth-key>");
  });

  it("omits the docker section on rotate/connect", () => {
    const snippet = buildKopiaQuickstart({ ...opts, create: false });
    expect(snippet).not.toContain("backup-client");
  });
});

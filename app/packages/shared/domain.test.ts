import { describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { addFriendInput } from "./domain.ts";

describe("addFriendInput name bounds", () => {
  const parse = (name: string) =>
    addFriendInput.safeParse({
      name,
      quotaBytes: 1024,
      retentionDays: 30,
      isolationMode: "dedicated",
      lockMode: "GOVERNANCE",
    });

  it("rejects names below MinIO's 3-char bucket minimum", () => {
    expect(parse("ab").success).toBe(false);
  });

  it("rejects names above 50 chars (p0rt1on- prefix headroom in DNS labels)", () => {
    expect(parse("a".repeat(51)).success).toBe(false);
  });

  it("accepts the 3- and 50-char boundary values", () => {
    expect(parse("abc").success).toBe(true);
    expect(parse("a".repeat(50)).success).toBe(true);
  });

  it("rejects a trailing hyphen (invalid S3 bucket name and DNS label)", () => {
    expect(parse("abc-").success).toBe(false);
  });
});

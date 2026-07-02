import { describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { manualAclInstructions } from "./manualAcl.ts";

describe("manualAclInstructions", () => {
  it("renders the tagOwner + a tag→endpoint grant to paste", () => {
    const out = manualAclInstructions(
      "tag:p0rt1on-friend-alice",
      "alice.tailXXXX.ts.net:443",
      "autogroup:admin",
    );

    expect(out).toContain("tagOwners");
    expect(out).toContain("grants");
    expect(out).toContain("tag:p0rt1on-friend-alice");
    expect(out).toContain("alice.tailXXXX.ts.net"); // bare host in dst
    expect(out).toContain("tcp:443"); // port in ip
    expect(out).toContain("autogroup:admin");
    // The grant must scope the tag to ONLY that endpoint.
    expect(out).toContain(`"dst"`);
  });
});

import { describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import {
  manualAclInstructions,
  manualAclRemovalInstructions,
} from "./manualAcl.ts";

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

  it("omits tagOwners for a user-email src (the user owns itself)", () => {
    const out = manualAclInstructions(
      "bob@example.com",
      "alice.tailXXXX.ts.net:443",
      "autogroup:admin",
    );

    expect(out).not.toContain("tagOwners");
    expect(out).toContain("grants");
    expect(out).toContain("bob@example.com");
    expect(out).toContain("tcp:443");
  });
});

describe("manualAclRemovalInstructions", () => {
  it("names the tagOwners + grant entries for a tag src", () => {
    const out = manualAclRemovalInstructions("tag:p0rt1on-friend-alice");
    expect(out).toContain("tagOwners");
    expect(out).toContain(`"src": ["tag:p0rt1on-friend-alice"]`);
  });

  it("names only the grant entry for a user-email src", () => {
    const out = manualAclRemovalInstructions("bob@example.com");
    expect(out).not.toContain("tagOwners");
    expect(out).toContain(`"src": ["bob@example.com"]`);
  });
});

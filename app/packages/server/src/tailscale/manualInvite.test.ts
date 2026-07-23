import { describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import {
  manualInviteInstructions,
  manualUserRemovalInstructions,
} from "./manualInvite.ts";

describe("manualInvite", () => {
  it("manualInviteInstructions names the console path, member role, and the email", () => {
    const text = manualInviteInstructions("bob@example.com");
    expect(text).toContain("https://login.tailscale.com/admin/users");
    expect(text).toContain("bob@example.com");
    expect(text).toContain("Member");
    // It must tell the admin how to make it automatic next time.
    expect(text).toContain("P0RT1ON_TAILSCALE_API_TOKEN");
  });

  it("manualUserRemovalInstructions names the user and the console", () => {
    const text = manualUserRemovalInstructions("bob@example.com");
    expect(text).toContain("https://login.tailscale.com/admin/users");
    expect(text).toContain("bob@example.com");
    expect(text).toContain("Delete user");
  });
});

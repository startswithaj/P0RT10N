import { describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import {
  buildProvisioningService,
  type Calls,
  DEDICATED_RES,
  INVITE_CTX,
  INVITE_INPUT,
  mockUserInviteApi,
} from "../test-helpers/mocks.ts";

describe("ProvisioningService.addFriend (invite enrollment)", () => {
  it("with a token: creates the invite, mints NO friend auth key, links in the bundle", async () => {
    const calls: Calls = [];
    const bundle = await buildProvisioningService(calls, DEDICATED_RES, {
      userInvite: mockUserInviteApi(calls),
    }).addFriend(INVITE_INPUT);

    expect(calls).toContain("invite:create:bob@example.com");
    expect(calls).toContain("repo:recordInvite:pending");
    // No friend auth key is minted or persisted in invite mode. The serve
    // node's own key still is minted, but that's a different tag.
    expect(calls.some((c) => c.startsWith("ts:mintAuthKey:tag:p0rt1on-friend")))
      .toBe(false);
    expect(calls.some((c) => c.startsWith("repo:recordTsKeyId"))).toBe(false);

    expect(bundle.enrollmentMode).toBe("invite");
    expect(bundle.inviteEmail).toBe("bob@example.com");
    expect(bundle.inviteUrl).toContain("uinv/inv1");
    expect(bundle.tsAuthKey).toBeUndefined();
    expect(bundle.tailscaleUpCommand).toBeUndefined();
    // The quickstart join has the friend generate their own key. It's a
    // placeholder, never a real minted secret.
    expect(bundle.kopiaQuickstart).toContain(
      "tailscale up --authkey=<your-tailscale-auth-key>",
    );
    expect(bundle.kopiaQuickstart).toContain("generate an auth key");
    expect(bundle.kopiaQuickstart).not.toContain("tskey-");
  });

  it("writes an identity (email) ACL grant, not a tag grant", async () => {
    const calls: Calls = [];
    let aclSrc = "";
    await buildProvisioningService(calls, DEDICATED_RES, {
      userInvite: mockUserInviteApi(calls),
      tailscale: {
        ensureFriendAcl: (src) => {
          aclSrc = src;
          return Promise.resolve();
        },
      },
    }).addFriend(INVITE_INPUT);

    expect(aclSrc).toBe("bob@example.com");
  });

  it("with no token: completes with a manual-invite advisory and no key", async () => {
    const calls: Calls = [];
    const bundle = await buildProvisioningService(calls, DEDICATED_RES, {
      userInvite: mockUserInviteApi(calls, { configured: false }),
    }).addFriend(INVITE_INPUT);

    expect(calls).toContain("repo:recordInvite:manual");
    expect(calls.some((c) => c.startsWith("invite:create"))).toBe(false);
    expect(bundle.manualInviteInstructions).toContain("Invite this friend");
    expect(bundle.inviteUrl).toBeUndefined();
  });

  it("degrades to a manual advisory + warning when invite creation fails", async () => {
    const calls: Calls = [];
    const bundle = await buildProvisioningService(calls, DEDICATED_RES, {
      userInvite: mockUserInviteApi(calls, {
        createUserInvite: () => Promise.reject(new Error("token expired")),
      }),
    }).addFriend(INVITE_INPUT);

    expect(calls).toContain("repo:recordInvite:manual");
    expect(bundle.manualInviteInstructions).toBeDefined();
    expect(bundle.warnings?.[0]).toContain("could not be sent");
  });
});

describe("ProvisioningService.offboard (invite enrollment)", () => {
  it("with a token: revokes the pending invite and deletes the joined member", async () => {
    const calls: Calls = [];
    const result = await buildProvisioningService(calls, DEDICATED_RES, {
      repo: { context: () => Promise.resolve(INVITE_CTX) },
      userInvite: mockUserInviteApi(calls, {
        findUserByEmail: (email) =>
          Promise.resolve({ id: "u1", loginName: email, role: "member" }),
      }),
    }).offboard(1);

    expect(calls).toContain("invite:deleteInvite:inv1");
    expect(calls).toContain("invite:deleteUser:u1");
    // No tagged-node revoke fires for an invite friend.
    expect(calls.some((c) => c.startsWith("ts:deleteNode"))).toBe(false);
    expect(result.manualUserRemoval).toBeUndefined();
  });

  it("skips deleteUser when another portion shares the email (advises instead)", async () => {
    const calls: Calls = [];
    const result = await buildProvisioningService(calls, DEDICATED_RES, {
      repo: {
        context: () => Promise.resolve(INVITE_CTX),
        otherFriendsWithInviteEmail: () => Promise.resolve(1),
      },
      userInvite: mockUserInviteApi(calls, {
        findUserByEmail: (email) =>
          Promise.resolve({ id: "u1", loginName: email, role: "member" }),
      }),
    }).offboard(1);

    expect(calls.some((c) => c.startsWith("invite:deleteUser"))).toBe(false);
    expect(result.manualUserRemoval).toContain("Delete user");
  });

  it("does not delete a non-member user; advises instead", async () => {
    const calls: Calls = [];
    const result = await buildProvisioningService(calls, DEDICATED_RES, {
      repo: { context: () => Promise.resolve(INVITE_CTX) },
      userInvite: mockUserInviteApi(calls, {
        findUserByEmail: (email) =>
          Promise.resolve({ id: "u1", loginName: email, role: "admin" }),
      }),
    }).offboard(1);

    expect(calls.some((c) => c.startsWith("invite:deleteUser"))).toBe(false);
    expect(result.manualUserRemoval).toBeDefined();
  });

  it("leaves the user alone when the invite was never accepted (no user)", async () => {
    const calls: Calls = [];
    const result = await buildProvisioningService(calls, DEDICATED_RES, {
      repo: { context: () => Promise.resolve(INVITE_CTX) },
      userInvite: mockUserInviteApi(calls), // findUserByEmail returns null by default
    }).offboard(1);

    expect(calls).toContain("invite:deleteInvite:inv1");
    expect(calls.some((c) => c.startsWith("invite:deleteUser"))).toBe(false);
    expect(result.manualUserRemoval).toBeUndefined();
  });

  it("with no token: advises manual user removal and still completes", async () => {
    const calls: Calls = [];
    const result = await buildProvisioningService(calls, DEDICATED_RES, {
      repo: { context: () => Promise.resolve(INVITE_CTX) },
      userInvite: mockUserInviteApi(calls, { configured: false }),
    }).offboard(1);

    expect(calls.some((c) => c.startsWith("invite:"))).toBe(false);
    expect(result.manualUserRemoval).toContain("was not removed");
  });
});

describe("ProvisioningService failure-reap (invite)", () => {
  it("revokes a dangling pending invite during the sweep", async () => {
    const calls: Calls = [];
    await buildProvisioningService(calls, DEDICATED_RES, {
      repo: {
        failedFriendIds: () => Promise.resolve([1]),
        context: () => Promise.resolve(INVITE_CTX),
      },
      userInvite: mockUserInviteApi(calls),
    }).sweepFailed();

    expect(calls).toContain("invite:deleteInvite:inv1");
  });
});

describe("ProvisioningService.reissueTsKey (invite guard)", () => {
  it("rejects an invite-enrolled friend (no auth key to re-issue)", async () => {
    const calls: Calls = [];
    await expect(
      buildProvisioningService(calls, DEDICATED_RES, {
        repo: { context: () => Promise.resolve(INVITE_CTX) },
      }).reissueTsKey(1),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    // No key was minted for the invite friend.
    expect(calls.some((c) => c.startsWith("ts:mintAuthKey"))).toBe(false);
  });
});

describe("ProvisioningService.resendInvite", () => {
  it("resends the pending invite when a token is configured", async () => {
    const calls: Calls = [];
    await buildProvisioningService(calls, DEDICATED_RES, {
      repo: { context: () => Promise.resolve(INVITE_CTX) },
      userInvite: mockUserInviteApi(calls),
    }).resendInvite(1);

    expect(calls).toContain("invite:resend:inv1");
  });

  it("throws PRECONDITION_FAILED with no token", async () => {
    const calls: Calls = [];
    await expect(
      buildProvisioningService(calls, DEDICATED_RES, {
        repo: { context: () => Promise.resolve(INVITE_CTX) },
        userInvite: mockUserInviteApi(calls, { configured: false }),
      }).resendInvite(1),
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  });

  it("rejects a non-invite friend", async () => {
    const calls: Calls = [];
    await expect(
      buildProvisioningService(calls, DEDICATED_RES, {
        repo: {
          context: () =>
            Promise.resolve({
              ...INVITE_CTX,
              enrollmentMode: "authKey",
              inviteId: null,
            }),
        },
      }).resendInvite(1),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });
});

describe("ProvisioningService.inviteStatus", () => {
  it("pending while the invite still GETs", async () => {
    const calls: Calls = [];
    const view = await buildProvisioningService(calls, DEDICATED_RES, {
      repo: { context: () => Promise.resolve(INVITE_CTX) },
      userInvite: mockUserInviteApi(calls, {
        getUserInvite: (id) =>
          Promise.resolve({
            id,
            email: "bob@example.com",
            inviteUrl: "https://login.tailscale.com/uinv/inv1",
            lastEmailSentAt: "2026-07-01T00:00:00Z",
          }),
      }),
    }).inviteStatus(1);

    expect(view.status).toBe("pending");
    expect(view.inviteUrl).toContain("inv1");
    expect(view.emailedAt).toBe("2026-07-01T00:00:00Z");
    expect(calls).toContain("repo:recordInvite:pending");
  });

  it("accepted when the user has joined (via tailscale.hasJoined)", async () => {
    const calls: Calls = [];
    const view = await buildProvisioningService(calls, DEDICATED_RES, {
      repo: { context: () => Promise.resolve(INVITE_CTX) },
      // Acceptance is read off the OAuth API (users list or devices), not the
      // personal token. It works even with no token configured.
      tailscale: { hasJoined: () => Promise.resolve(true) },
      userInvite: mockUserInviteApi(calls, { configured: false }),
    }).inviteStatus(1);

    expect(view.status).toBe("accepted");
    expect(calls).toContain("repo:recordInvite:accepted");
  });

  it("expired when the invite is gone and no user exists", async () => {
    const calls: Calls = [];
    const view = await buildProvisioningService(calls, DEDICATED_RES, {
      repo: { context: () => Promise.resolve(INVITE_CTX) },
      userInvite: mockUserInviteApi(calls),
    }).inviteStatus(1);

    expect(view.status).toBe("expired");
    expect(calls).toContain("repo:recordInvite:expired");
  });

  it("manual (no token, no invite id) while not yet joined", async () => {
    const calls: Calls = [];
    const view = await buildProvisioningService(calls, DEDICATED_RES, {
      // No invite id means the admin invited by hand; not yet joined still counts as manual.
      repo: {
        context: () => Promise.resolve({ ...INVITE_CTX, inviteId: null }),
      },
      userInvite: mockUserInviteApi(calls, { configured: false }),
    }).inviteStatus(1);

    expect(view.status).toBe("manual");
  });

  it("rejects a non-invite friend", async () => {
    const calls: Calls = [];
    await expect(
      buildProvisioningService(calls, DEDICATED_RES, {
        repo: {
          context: () =>
            Promise.resolve({
              ...INVITE_CTX,
              enrollmentMode: "authKey",
              inviteEmail: null,
            }),
        },
      }).inviteStatus(1),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });
});

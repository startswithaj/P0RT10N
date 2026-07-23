import { describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { TailscaleUserInviteApi } from "./TailscaleUserInviteApi.ts";
import { ServiceError } from "../lib/ServiceError.ts";
import { fakeFetch, type RecordedRequest } from "../test-helpers/mocks.ts";

describe("TailscaleUserInviteApi", () => {
  const TOKEN = "tskey-api-abc123";

  const build = (
    reqs: RecordedRequest[],
    handler: Parameters<typeof fakeFetch>[1] = () => ({ json: {} }),
  ) =>
    new TailscaleUserInviteApi(
      { token: TOKEN, baseUrl: "http://ts.test/api/v2" },
      fakeFetch(reqs, handler),
    );

  const invite = {
    id: "inv1",
    email: "bob@example.com",
    inviteUrl: "https://login.tailscale.com/uinv/xyz",
    lastEmailSentAt: "2026-01-01T00:00:00Z",
  };

  it("createUserInvite posts a member-role invite as a LIST to the tailnet path", async () => {
    const reqs: RecordedRequest[] = [];
    await build(reqs, () => ({ json: [invite] })).createUserInvite(
      "bob@example.com",
    );
    expect(reqs[0].method).toBe("POST");
    expect(reqs[0].url).toBe("http://ts.test/api/v2/tailnet/-/user-invites");
    expect(JSON.parse(reqs[0].body ?? "{}")).toEqual([
      { role: "member", email: "bob@example.com" },
    ]);
  });

  it("createUserInvite returns id/inviteUrl/lastEmailSentAt from the first entry", async () => {
    const result = await build([], () => ({ json: [invite] })).createUserInvite(
      "bob@example.com",
    );
    expect(result).toEqual({
      id: "inv1",
      email: "bob@example.com",
      inviteUrl: "https://login.tailscale.com/uinv/xyz",
      lastEmailSentAt: "2026-01-01T00:00:00Z",
    });
  });

  it("createUserInvite surfaces a 403 as a ServiceError (no fake success)", async () => {
    let err: unknown;
    try {
      await build([], () => ({ status: 403, json: { message: "nope" } }))
        .createUserInvite("bob@example.com");
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(ServiceError);
    expect((err as ServiceError).code).toBe("FORBIDDEN");
  });

  it("getUserInvite GETs the root-scoped /user-invites/{id} path", async () => {
    const reqs: RecordedRequest[] = [];
    const got = await build(reqs, () => ({ json: invite })).getUserInvite(
      "inv1",
    );
    expect(reqs[0].method).toBe("GET");
    expect(reqs[0].url).toBe("http://ts.test/api/v2/user-invites/inv1");
    expect(got?.id).toBe("inv1");
  });

  it("getUserInvite returns null on 404 (accepted/expired/revoked)", async () => {
    const got = await build([], () => ({ status: 404, json: {} }))
      .getUserInvite(
        "gone",
      );
    expect(got).toBe(null);
  });

  it("resendUserInvite POSTs the resend path", async () => {
    const reqs: RecordedRequest[] = [];
    await build(reqs, () => ({ status: 200, json: {} })).resendUserInvite(
      "inv1",
    );
    expect(reqs[0].method).toBe("POST");
    expect(reqs[0].url).toBe("http://ts.test/api/v2/user-invites/inv1/resend");
  });

  it("resendUserInvite maps 429 to a TOO_MANY_REQUESTS ServiceError", async () => {
    let err: unknown;
    try {
      await build([], () => ({ status: 429, json: { message: "slow down" } }))
        .resendUserInvite("inv1");
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(ServiceError);
    expect((err as ServiceError).code).toBe("TOO_MANY_REQUESTS");
  });

  it("deleteUserInvite DELETEs by id and tolerates 404 (already gone)", async () => {
    const reqs: RecordedRequest[] = [];
    // 404 must NOT throw (idempotency house rule).
    await build(reqs, () => ({ status: 404, json: {} })).deleteUserInvite(
      "inv1",
    );
    expect(reqs[0].method).toBe("DELETE");
    expect(reqs[0].url).toBe("http://ts.test/api/v2/user-invites/inv1");
  });

  it("findUserByEmail matches loginName case-insensitively, null when absent", async () => {
    const users = {
      users: [
        { id: "u1", loginName: "Bob@Example.com", role: "member" },
        { id: "u2", loginName: "carol@example.com", role: "admin" },
      ],
    };
    const api = build([], () => ({ json: users }));
    expect(await api.findUserByEmail("bob@example.com")).toEqual({
      id: "u1",
      loginName: "Bob@Example.com",
      role: "member",
    });
    expect(await api.findUserByEmail("nobody@example.com")).toBe(null);
  });

  it("deleteUser POSTs /user/{id}/delete and tolerates 404", async () => {
    const reqs: RecordedRequest[] = [];
    await build(reqs, () => ({ status: 404, json: {} })).deleteUser("u1");
    expect(reqs[0].method).toBe("POST");
    expect(reqs[0].url).toBe("http://ts.test/api/v2/user/u1/delete");
  });

  it("getUserInvite rethrows a non-404 error (real failure isn't swallowed)", async () => {
    let err: unknown;
    try {
      await build([], () => ({ status: 500, json: {} })).getUserInvite("x");
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(ServiceError);
  });

  it("getUserInvite tolerates a missing lastEmailSentAt (null)", async () => {
    const got = await build([], () => ({
      json: { id: "i", email: "b@e.com", inviteUrl: "u" },
    })).getUserInvite("i");
    expect(got?.lastEmailSentAt).toBe(null);
  });

  it("deleteUserInvite rethrows a non-404 error", async () => {
    let err: unknown;
    try {
      await build([], () => ({ status: 500, json: {} })).deleteUserInvite("x");
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(ServiceError);
  });

  it("deleteUser rethrows a non-404 error", async () => {
    let err: unknown;
    try {
      await build([], () => ({ status: 500, json: {} })).deleteUser("x");
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(ServiceError);
  });

  it("resendUserInvite rethrows a non-429 error unchanged", async () => {
    let err: unknown;
    try {
      await build([], () => ({ status: 500, json: {} })).resendUserInvite("x");
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(ServiceError);
    expect((err as ServiceError).code).toBe("INTERNAL_SERVER_ERROR");
  });

  it("a 204 response resolves with no body", async () => {
    // Exercises the 204 branch in request() — no throw, no parse.
    await build([], () => ({ status: 204 })).deleteUserInvite("i");
  });

  it("configured reflects whether a token is set", () => {
    expect(build([]).configured).toBe(true);
    expect(new TailscaleUserInviteApi({}).configured).toBe(false);
  });

  it("throws PRECONDITION_FAILED when unconfigured (no token)", async () => {
    let err: unknown;
    try {
      await new TailscaleUserInviteApi({}).createUserInvite("bob@example.com");
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(ServiceError);
    expect((err as ServiceError).code).toBe("PRECONDITION_FAILED");
  });

  it("uses the personal token verbatim as Bearer (no OAuth exchange)", async () => {
    const reqs: RecordedRequest[] = [];
    await build(reqs, () => ({ json: [invite] })).createUserInvite(
      "bob@example.com",
    );
    expect(reqs[0].headers["authorization"]).toBe(`Bearer ${TOKEN}`);
    // A personal token is used as-is; nothing hits the oauth/token endpoint.
    expect(reqs.every((r) => !r.url.includes("/oauth/token"))).toBe(true);
  });
});

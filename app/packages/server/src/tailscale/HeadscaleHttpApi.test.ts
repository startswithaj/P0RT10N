import { describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { HeadscaleHttpApi } from "./HeadscaleHttpApi.ts";
import { fakeFetch, type RecordedRequest } from "../test-helpers/mocks.ts";

describe("HeadscaleHttpApi", () => {
  const build = (
    reqs: RecordedRequest[],
    handler: Parameters<typeof fakeFetch>[1] = () => ({ json: {} }),
  ) =>
    new HeadscaleHttpApi(
      {
        baseUrl: "http://hs.test",
        apiKey: "hs-api-key",
        user: "p0rt1on",
        baseDomain: "hs.test",
      },
      fakeFetch(reqs, handler),
      () => Date.parse("2026-01-01T00:00:00.000Z"),
    );

  const nodes = {
    nodes: [
      {
        id: "1",
        givenName: "alice",
        ipAddresses: ["fd7a::1", "100.64.0.7"],
        forcedTags: ["tag:p0rt1on-friend-alice"],
        online: true,
      },
      {
        id: "2",
        givenName: "bob",
        ipAddresses: ["100.64.0.8"],
        // Headscale reports the same tag in BOTH lists — must dedupe.
        forcedTags: ["tag:p0rt1on-friend-bob"],
        validTags: ["tag:p0rt1on-friend-bob"],
        online: false,
      },
      {
        id: "3",
        givenName: "carol",
        ipAddresses: ["100.64.0.9"],
        // 0.29+ reports one resolved list instead of the two above.
        tags: ["tag:p0rt1on-friend-carol"],
        online: true,
      },
    ],
  };

  it("mintAuthKey posts a user-scoped single-use tagged key with expiry", async () => {
    const reqs: RecordedRequest[] = [];
    const users = { users: [{ id: "7", name: "p0rt1on" }] };
    const minted = {
      preAuthKey: {
        id: "42",
        key: "hskey-secret",
        expiration: "2026-01-01T01:00:00.000Z",
      },
    };
    const key = await build(
      reqs,
      (req) =>
        req.url.endsWith("/api/v1/user") ? { json: users } : { json: minted },
    ).mintAuthKey({ tag: "tag:p0rt1on-friend-alice" });

    // The user NAME is resolved to its numeric id first (the API takes ids).
    expect(reqs[0].url).toBe("http://hs.test/api/v1/user");
    expect(reqs[1].url).toBe("http://hs.test/api/v1/preauthkey");
    expect(reqs[1].headers["authorization"]).toBe("Bearer hs-api-key");
    expect(JSON.parse(reqs[1].body ?? "{}")).toEqual({
      user: "7",
      reusable: false,
      ephemeral: false,
      aclTags: ["tag:p0rt1on-friend-alice"],
      // Default 1h window from the injected clock.
      expiration: "2026-01-01T01:00:00.000Z",
    });
    expect(key).toEqual({
      key: "hskey-secret",
      keyId: "42",
      tag: "tag:p0rt1on-friend-alice",
      expiresAt: "2026-01-01T01:00:00.000Z",
    });
  });

  it("revokeAuthKey expires by the key string matched from the list", async () => {
    const listed = {
      preAuthKeys: [
        { id: "41", key: "other", expiration: "" },
        { id: "42", key: "hskey-secret", expiration: "" },
      ],
    };
    const users = { users: [{ id: "7", name: "p0rt1on" }] };
    const reqs: RecordedRequest[] = [];
    await build(reqs, (req) => {
      if (req.url.endsWith("/api/v1/user")) return { json: users };
      return req.method === "GET" ? { json: listed } : { json: {} };
    }).revokeAuthKey("42");

    expect(reqs[1].url).toContain("/api/v1/preauthkey?user=7");
    expect(reqs[2].url).toBe("http://hs.test/api/v1/preauthkey/expire");
    expect(JSON.parse(reqs[2].body ?? "{}")).toEqual({
      user: "7",
      key: "hskey-secret",
    });
  });

  it("revokeAuthKey treats an unlisted key id as already revoked", async () => {
    const reqs: RecordedRequest[] = [];
    await build(
      reqs,
      (req) =>
        req.url.endsWith("/api/v1/user")
          ? { json: { users: [{ id: "7", name: "p0rt1on" }] } }
          : { json: { preAuthKeys: [] } },
    ).revokeAuthKey("42");
    // No expire call follows the list — absent is success (idempotency rule).
    expect(reqs.map((r) => r.method)).toEqual(["GET", "GET"]);
  });

  it("an unknown user name fails loudly with the create hint", async () => {
    const missing = build([], () => ({ json: { users: [] } }));
    await expect(missing.mintAuthKey({ tag: "tag:x" })).rejects.toThrow(
      'headscale user "p0rt1on" not found',
    );
  });

  it("nodesByTag merges forced+valid tags and keeps the real online flag", async () => {
    const found = await build([], () => ({ json: nodes }))
      .nodesByTag("tag:p0rt1on-friend-bob");
    expect(found).toEqual([{
      nodeId: "2",
      hostname: "bob",
      tags: ["tag:p0rt1on-friend-bob"],
      online: false,
    }]);
  });

  it("nodesByTag reads the single `tags` list headscale 0.29+ returns", async () => {
    const found = await build([], () => ({ json: nodes }))
      .nodesByTag("tag:p0rt1on-friend-carol");
    expect(found).toEqual([{
      nodeId: "3",
      hostname: "carol",
      tags: ["tag:p0rt1on-friend-carol"],
      online: true,
    }]);
  });

  it("nodeIpv4 picks the 100.x address by givenName", async () => {
    const api = build([], () => ({ json: nodes }));
    expect(await api.nodeIpv4("alice")).toBe("100.64.0.7");
    expect(await api.nodeIpv4("nobody")).toBeNull();
  });

  it("nodeFqdn composes givenName + configured base domain, else null", async () => {
    const api = build([], () => ({ json: nodes }));
    expect(await api.nodeFqdn("alice")).toBe("alice.hs.test");
    expect(await api.nodeFqdn("nobody")).toBeNull();
  });

  it("ensureFriendAcl writes the acls rule + tagOwners into the policy string", async () => {
    const reqs: RecordedRequest[] = [];
    await build(
      reqs,
      (req) => req.method === "GET" ? { json: { policy: "" } } : { json: {} },
    )
      .ensureFriendAcl("tag:p0rt1on-friend-alice", "alice.ts.net:443");

    const put = reqs.find((r) => r.method === "PUT");
    expect(put?.url).toBe("http://hs.test/api/v1/policy");
    // The policy rides as a JSON STRING inside the envelope.
    const policy = JSON.parse(JSON.parse(put?.body ?? "{}").policy);
    expect(policy).toEqual({
      tagOwners: { "tag:p0rt1on-friend-alice": ["p0rt1on@"] },
      acls: [{
        action: "accept",
        src: ["tag:p0rt1on-friend-alice"],
        dst: ["alice.ts.net:443"],
      }],
    });
  });

  it("ensureFriendAcl creates the FIRST policy when none exists yet (500)", async () => {
    // Fresh headscale in database mode: GET /policy is a 500 "not found",
    // which must read as "empty policy", not a failure.
    const reqs: RecordedRequest[] = [];
    await build(reqs, (req) => {
      if (req.method === "GET") {
        return {
          status: 500,
          json: {
            code: 2,
            message: "loading ACL from database: acl policy not found",
          },
        };
      }
      return { json: {} };
    }).ensureFriendAcl("tag:p0rt1on-friend-alice", "alice.ts.net:443");

    const put = reqs.find((r) => r.method === "PUT");
    const policy = JSON.parse(JSON.parse(put?.body ?? "{}").policy);
    expect(policy.acls).toEqual([{
      action: "accept",
      src: ["tag:p0rt1on-friend-alice"],
      dst: ["alice.ts.net:443"],
    }]);
  });

  it("ensureTagOwner writes an absent tag into the policy tagOwners", async () => {
    const reqs: RecordedRequest[] = [];
    await build(
      reqs,
      (req) => req.method === "GET" ? { json: { policy: "" } } : { json: {} },
    ).ensureTagOwner("tag:p0rt1on-serve");

    const put = reqs.find((r) => r.method === "PUT");
    const policy = JSON.parse(JSON.parse(put?.body ?? "{}").policy);
    expect(policy.tagOwners).toEqual({ "tag:p0rt1on-serve": ["p0rt1on@"] });
  });

  it("ensureTagOwner is a no-op when the tag is already owned", async () => {
    const existing = JSON.stringify({
      tagOwners: { "tag:p0rt1on-serve": ["p0rt1on@"] },
    });
    const reqs: RecordedRequest[] = [];
    await build(reqs, () => ({ json: { policy: existing } }))
      .ensureTagOwner("tag:p0rt1on-serve");
    expect(reqs.map((r) => r.method)).toEqual(["GET"]);
  });

  it("ensureFriendAcl is a no-op when the rule and owner already exist", async () => {
    const existing = JSON.stringify({
      tagOwners: { "tag:p0rt1on-friend-alice": ["p0rt1on@"] },
      acls: [{
        action: "accept",
        src: ["tag:p0rt1on-friend-alice"],
        dst: ["alice.ts.net:443"],
      }],
    });
    const reqs: RecordedRequest[] = [];
    await build(reqs, () => ({ json: { policy: existing } }))
      .ensureFriendAcl("tag:p0rt1on-friend-alice", "alice.ts.net:443");
    expect(reqs.map((r) => r.method)).toEqual(["GET"]);
  });

  it("ensureFriendAcl replaces a stale rule for the same friend", async () => {
    const stale = JSON.stringify({
      tagOwners: { "tag:p0rt1on-friend-alice": ["p0rt1on@"] },
      acls: [{
        action: "accept",
        src: ["tag:p0rt1on-friend-alice"],
        dst: ["old-host:443"],
      }],
    });
    const reqs: RecordedRequest[] = [];
    await build(
      reqs,
      (req) =>
        req.method === "GET" ? { json: { policy: stale } } : { json: {} },
    )
      .ensureFriendAcl("tag:p0rt1on-friend-alice", "alice.ts.net:443");

    const put = reqs.find((r) => r.method === "PUT");
    const policy = JSON.parse(JSON.parse(put?.body ?? "{}").policy);
    // Replaced, not accumulated beside the stale rule.
    expect(policy.acls).toEqual([{
      action: "accept",
      src: ["tag:p0rt1on-friend-alice"],
      dst: ["alice.ts.net:443"],
    }]);
  });

  it("removeFriendAcl strips the friend's rule and tag ownership", async () => {
    const existing = JSON.stringify({
      tagOwners: {
        "tag:p0rt1on-friend-alice": ["p0rt1on@"],
        "tag:p0rt1on-friend-bob": ["p0rt1on@"],
      },
      acls: [
        {
          action: "accept",
          src: ["tag:p0rt1on-friend-alice"],
          dst: ["alice.ts.net:443"],
        },
        {
          action: "accept",
          src: ["tag:p0rt1on-friend-bob"],
          dst: ["bob.ts.net:443"],
        },
      ],
    });
    const reqs: RecordedRequest[] = [];
    await build(
      reqs,
      (req) =>
        req.method === "GET" ? { json: { policy: existing } } : { json: {} },
    )
      .removeFriendAcl("tag:p0rt1on-friend-alice");

    const put = reqs.find((r) => r.method === "PUT");
    const policy = JSON.parse(JSON.parse(put?.body ?? "{}").policy);
    expect(policy).toEqual({
      tagOwners: { "tag:p0rt1on-friend-bob": ["p0rt1on@"] },
      acls: [{
        action: "accept",
        src: ["tag:p0rt1on-friend-bob"],
        dst: ["bob.ts.net:443"],
      }],
    });
  });

  it("deleteNode targets the node id; failures surface with the status", async () => {
    const reqs: RecordedRequest[] = [];
    await build(reqs, () => ({ json: {} })).deleteNode("7");
    expect(reqs[0].method).toBe("DELETE");
    expect(reqs[0].url).toBe("http://hs.test/api/v1/node/7");

    const failing = build([], () => ({ status: 500, json: {} }));
    await expect(failing.deleteNode("7")).rejects.toThrow("failed (500)");
  });
});

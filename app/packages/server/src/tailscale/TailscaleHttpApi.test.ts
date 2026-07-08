import { describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { TailscaleHttpApi } from "./TailscaleHttpApi.ts";
import { fakeFetch, type RecordedRequest } from "../test-helpers/mocks.ts";

describe("TailscaleHttpApi", () => {
  const NOW = Date.parse("2026-06-30T12:00:00Z");
  const FRESH = "2026-06-30T11:55:00Z"; // 5 min ago < 15 min window
  const STALE = "2026-06-30T11:00:00Z"; // 60 min ago

  function api(
    recorded: RecordedRequest[],
    handler: (
      req: RecordedRequest,
    ) => { status?: number; json?: unknown; headers?: Record<string, string> },
  ) {
    return new TailscaleHttpApi(
      { token: "tok", baseUrl: "https://api.test/v2" },
      fakeFetch(recorded, handler),
      () => NOW,
    );
  }

  it("mintAuthKey POSTs a preauthorized, tagged, single-use key", async () => {
    const reqs: RecordedRequest[] = [];
    const minted = await api(reqs, () => ({
      json: { id: "k1", key: "tskey-secret", expires: "2099-01-01T00:00:00Z" },
    })).mintAuthKey({ tag: "tag:p0rt1on-friend-alice", expirySeconds: 3600 });

    expect(reqs[0].method).toBe("POST");
    expect(reqs[0].url).toBe("https://api.test/v2/tailnet/-/keys");
    const body = JSON.parse(reqs[0].body ?? "{}");
    expect(body.capabilities.devices.create.preauthorized).toBe(true);
    expect(body.capabilities.devices.create.reusable).toBe(false);
    expect(body.capabilities.devices.create.tags).toEqual([
      "tag:p0rt1on-friend-alice",
    ]);
    expect(minted).toEqual({
      key: "tskey-secret",
      keyId: "k1",
      tag: "tag:p0rt1on-friend-alice",
      expiresAt: "2099-01-01T00:00:00Z",
    });
  });

  it("nodesByTag filters by tag and derives online from lastSeen", async () => {
    const reqs: RecordedRequest[] = [];
    const nodes = await api(reqs, () => ({
      json: {
        devices: [
          {
            id: "n1",
            hostname: "alice",
            tags: ["tag:p0rt1on-friend-alice"],
            lastSeen: FRESH,
          },
          {
            id: "n2",
            hostname: "bob",
            tags: ["tag:p0rt1on-friend-bob"],
            lastSeen: STALE,
          },
          {
            id: "n3",
            hostname: "x",
            tags: ["tag:p0rt1on-friend-alice"],
            lastSeen: STALE,
          },
        ],
      },
    })).nodesByTag("tag:p0rt1on-friend-alice");

    expect(reqs[0].url).toBe("https://api.test/v2/tailnet/-/devices");
    expect(nodes.map((n) => n.nodeId)).toEqual(["n1", "n3"]);
    expect(nodes[0].online).toBe(true); // fresh
    expect(nodes[1].online).toBe(false); // stale
  });

  it("isNodeOnline is true when any tagged node is fresh", async () => {
    const fresh = await api([], () => ({
      json: {
        devices: [{ id: "n1", hostname: "a", tags: ["t"], lastSeen: FRESH }],
      },
    })).isNodeOnline("t");
    expect(fresh).toBe(true);

    const stale = await api([], () => ({
      json: {
        devices: [{ id: "n1", hostname: "a", tags: ["t"], lastSeen: STALE }],
      },
    })).isNodeOnline("t");
    expect(stale).toBe(false);
  });

  it("revokeAuthKey and deleteNode issue DELETEs to the right paths", async () => {
    const reqs: RecordedRequest[] = [];
    const client = api(reqs, () => ({ status: 204 }));
    await client.revokeAuthKey("k1");
    await client.deleteNode("n9");
    expect(reqs[0]).toMatchObject({
      method: "DELETE",
      url: "https://api.test/v2/tailnet/-/keys/k1",
    });
    expect(reqs[1]).toMatchObject({
      method: "DELETE",
      url: "https://api.test/v2/device/n9",
    });
  });

  it("revokeAuthKey tolerates an already-revoked key (404) but not other errors", async () => {
    // Teardown idempotency: "already absent" is success.
    await expect(
      api([], () => ({ status: 404, json: { message: "key not found" } }))
        .revokeAuthKey("k-gone"),
    ).resolves.toBeUndefined();

    await expect(
      api([], () => ({ status: 500, json: { message: "boom" } }))
        .revokeAuthKey("k1"),
    ).rejects.toThrow("failed (500)");
  });

  it("throws on a non-2xx response", async () => {
    await expect(
      api([], () => ({ status: 403, json: { message: "denied" } }))
        .nodesByTag("t"),
    ).rejects.toThrow("failed (403)");
  });

  it("nodeIpv4 returns the 100.x address for a hostname, else null", async () => {
    const devices = {
      devices: [
        { hostname: "alice", addresses: ["fd7a::1", "100.64.0.9"] },
        { hostname: "bob", addresses: ["100.64.0.10"] },
      ],
    };
    const client = api([], () => ({ json: devices }));
    expect(await client.nodeIpv4("alice")).toBe("100.64.0.9");
    expect(await client.nodeIpv4("nobody")).toBe(null);
  });

  it("exchanges an OAuth client secret for an access token, then uses it", async () => {
    const reqs: RecordedRequest[] = [];
    const client = new TailscaleHttpApi(
      {
        token: "tskey-client-CID-secret",
        baseUrl: "https://api.test/v2",
      },
      fakeFetch(reqs, (req) => {
        if (req.url.endsWith("/oauth/token")) {
          return { json: { access_token: "tskey-api-xyz", expires_in: 3600 } };
        }
        return { json: { grants: [], tagOwners: {} }, headers: { ETag: "v1" } };
      }),
      () => NOW,
    );

    await client.ensureFriendAcl(
      "tag:p0rt1on-friend-alice",
      "alice.example.ts.net:443",
    );

    // First call is the token exchange (POST form to /oauth/token).
    expect(reqs[0].url).toContain("/oauth/token");
    expect(reqs[0].method).toBe("POST");
    expect(reqs[0].body).toContain("client_id=CID");
    // API calls carry the EXCHANGED access token, not the client secret.
    const aclReq = reqs.find((r) => r.url.includes("/acl"));
    expect(aclReq?.headers["authorization"]).toBe("Bearer tskey-api-xyz");
    // One exchange despite GET+POST (cached until expiry).
    expect(reqs.filter((r) => r.url.endsWith("/oauth/token"))).toHaveLength(1);
  });

  it("ensureFriendAcl GETs the policy then POSTs a tag-scoped grant + owner", async () => {
    const reqs: RecordedRequest[] = [];
    const client = api(reqs, (req) => {
      if (req.method === "GET") {
        return { json: { grants: [], tagOwners: {} }, headers: { ETag: "v1" } };
      }
      return { status: 200 };
    });

    await client.ensureFriendAcl(
      "tag:p0rt1on-friend-alice",
      "alice.example.ts.net:443",
    );

    expect(reqs.map((r) => r.method)).toEqual(["GET", "POST"]);
    expect(reqs[1].headers["if-match"]).toBe("v1");
    const body = JSON.parse(reqs[1].body ?? "{}");
    expect(body.tagOwners["tag:p0rt1on-friend-alice"]).toEqual([
      "autogroup:admin",
    ]);
    expect(body.grants).toEqual([
      {
        src: ["tag:p0rt1on-friend-alice"],
        dst: ["alice.example.ts.net"], // bare host — no colon (Tailscale rejects it)
        ip: ["tcp:443"], // port lives here
      },
    ]);
  });

  it("ensureFriendAcl throws ManualAclRequired (with paste-in lines) on 403", async () => {
    const client = api([], () => ({ status: 403, json: { message: "no" } }));

    await expect(
      client.ensureFriendAcl(
        "tag:p0rt1on-friend-alice",
        "alice.example.ts.net:443",
      ),
    ).rejects.toMatchObject({
      name: "ManualAclRequiredError",
      instructions: expect.stringContaining("alice.example.ts.net"),
    });
  });

  it("ensureFriendAcl is idempotent when the grant + owner already exist", async () => {
    const reqs: RecordedRequest[] = [];
    const client = api(reqs, () => ({
      json: {
        grants: [{
          src: ["tag:p0rt1on-friend-alice"],
          dst: ["alice.example.ts.net"],
          ip: ["tcp:443"],
        }],
        tagOwners: { "tag:p0rt1on-friend-alice": ["autogroup:admin"] },
      },
      headers: { ETag: "v1" },
    }));

    await client.ensureFriendAcl(
      "tag:p0rt1on-friend-alice",
      "alice.example.ts.net:443",
    );
    expect(reqs.map((r) => r.method)).toEqual(["GET"]); // no POST
  });

  it("ensureFriendAcl replaces a stale grant when the endpoint changed", async () => {
    const reqs: RecordedRequest[] = [];
    const client = api(reqs, (req) => {
      if (req.method !== "GET") return { status: 200 };
      return {
        json: {
          // Same friend, but the instance moved: old port 443 → now 9443.
          grants: [{
            src: ["tag:p0rt1on-friend-alice"],
            dst: ["alice.example.ts.net"],
            ip: ["tcp:443"],
          }],
          tagOwners: { "tag:p0rt1on-friend-alice": ["autogroup:admin"] },
        },
        headers: { ETag: "v1" },
      };
    });

    await client.ensureFriendAcl(
      "tag:p0rt1on-friend-alice",
      "alice.example.ts.net:9443",
    );

    const body = JSON.parse(reqs[1].body ?? "{}");
    // Old grant gone, new one present — not both.
    expect(body.grants).toEqual([{
      src: ["tag:p0rt1on-friend-alice"],
      dst: ["alice.example.ts.net"],
      ip: ["tcp:9443"],
    }]);
  });

  it("retries a policy write once on 412 (concurrent edit), then succeeds", async () => {
    const reqs: RecordedRequest[] = [];
    const client = api(reqs, (req) => {
      if (req.method === "GET") {
        return { json: { grants: [], tagOwners: {} }, headers: { ETag: "v1" } };
      }
      // First POST hits the CAS conflict; the retry (after re-GET) succeeds.
      const priorPosts = reqs.filter((r) => r.method === "POST").length;
      return priorPosts <= 1 ? { status: 412, json: {} } : { status: 200 };
    });

    await client.ensureFriendAcl(
      "tag:p0rt1on-friend-alice",
      "alice.example.ts.net:443",
    );

    expect(reqs.map((r) => r.method)).toEqual(["GET", "POST", "GET", "POST"]);
  });

  it("surfaces a persistent 412 after bounded retries", async () => {
    const reqs: RecordedRequest[] = [];
    const client = api(
      reqs,
      (req) =>
        req.method === "GET"
          ? { json: { grants: [], tagOwners: {} }, headers: { ETag: "v1" } }
          : { status: 412, json: {} },
    );

    await expect(
      client.ensureFriendAcl(
        "tag:p0rt1on-friend-alice",
        "alice.example.ts.net:443",
      ),
    ).rejects.toThrow("failed (412)");
    // 3 attempts, no more.
    expect(reqs.filter((r) => r.method === "POST")).toHaveLength(3);
  });

  it("removeFriendAcl drops the friend's grant + tag ownership", async () => {
    const reqs: RecordedRequest[] = [];
    const client = api(reqs, (req) => {
      if (req.method !== "GET") return { status: 200 };
      return {
        json: {
          grants: [
            { src: ["tag:p0rt1on-friend-alice"], dst: ["x"] },
            { src: ["tag:p0rt1on-friend-bob"], dst: ["y"] },
          ],
          tagOwners: {
            "tag:p0rt1on-friend-alice": ["a"],
            "tag:p0rt1on-friend-bob": ["b"],
          },
        },
        headers: { ETag: "v2" },
      };
    });

    await client.removeFriendAcl("tag:p0rt1on-friend-alice");

    const body = JSON.parse(reqs[1].body ?? "{}");
    expect(body.grants).toEqual([{
      src: ["tag:p0rt1on-friend-bob"],
      dst: ["y"],
    }]);
    expect(body.tagOwners["tag:p0rt1on-friend-alice"]).toBeUndefined();
    expect(body.tagOwners["tag:p0rt1on-friend-bob"]).toEqual(["b"]);
  });
});

import { describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { type FriendLookup, resolveFriend } from "./resolveFriend.ts";
import { parseMinioEvents } from "./parseMinioEvent.ts";

describe("resolveFriend (parse → look up friend → attach)", () => {
  const lookup: FriendLookup = (bucket) =>
    bucket === "alice" ? { id: 1, s3AccessKeyId: "KEY1" } : undefined;

  async function* stream(...raw: unknown[]) {
    yield* raw;
  }

  // The production chain: raw → parseMinioEvents → resolveFriend.
  const resolved = (...raw: unknown[]) =>
    Array.fromAsync(resolveFriend(lookup)(parseMinioEvents(stream(...raw))));

  it("keeps a friend's own event and attaches its friendId", async () => {
    const out = await resolved({
      accessKey: "KEY1",
      api: { name: "PutObject", bucket: "alice", rx: 5 },
    });
    expect(out.length).toBe(1);
    expect(out[0].friendId).toBe(1);
    expect(out[0].event.op).toBe("PutObject");
    expect(out[0].event.rx).toBe(5);
  });

  it("drops the manager's own root-key polling (access-key mismatch)", async () => {
    const out = await resolved(
      { accessKey: "ROOTKEY", api: { name: "HeadBucket", bucket: "alice" } },
    );
    expect(out).toEqual([]);
  });

  it("drops events for unknown buckets", async () => {
    const out = await resolved(
      { accessKey: "KEY1", api: { name: "GetObject", bucket: "ghost" } },
    );
    expect(out).toEqual([]);
  });

  it("drops unparseable payloads, keeping the valid ones", async () => {
    const out = await resolved(
      { nonsense: true },
      "not-json",
      { accessKey: "KEY1", api: { name: "GetObject", bucket: "alice" } },
    );
    expect(out.map((f) => f.event.op)).toEqual(["GetObject"]);
  });
});

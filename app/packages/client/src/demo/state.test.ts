import { beforeEach, describe, expect, it } from "vitest";
import {
  getDemoState,
  requireFriend,
  resetDemoState,
  toDetail,
  toListItem,
  updateDemoState,
} from "./state.ts";

beforeEach(() => {
  sessionStorage.clear();
  resetDemoState();
});

describe("demo state", () => {
  it("seeds four friends in id order", () => {
    expect(getDemoState().friends.map((f) => f.name)).toEqual([
      "alice",
      "bob",
      "carol",
      "dave",
    ]);
  });

  it("projects a list item (requests come from activity)", () => {
    const f = requireFriend(getDemoState(), 1);
    const item = toListItem(f);
    expect(item.requests24h).toBe(f.activity.requests24h);
    expect(item.lastRequestAt).toBe(f.activity.lastRequestAt);
    expect(item.enrollmentMode).toBe(f.enrollmentMode);
  });

  it("projects a detail (carries the full activity + endpoint facts)", () => {
    const f = requireFriend(getDemoState(), 1);
    const detail = toDetail(f);
    expect(detail.bucket).toBe(f.bucket);
    expect(detail.activity).toBe(f.activity);
    expect(detail.s3Endpoint).toBe(f.s3Endpoint);
  });

  it("requireFriend throws for an unknown id", () => {
    expect(() => requireFriend(getDemoState(), 999)).toThrow();
  });

  it("persists updates to sessionStorage", () => {
    updateDemoState((s) => ({ ...s, seq: s.seq + 1 }));
    expect(sessionStorage.getItem("p0rt1on-demo-state")).toContain('"seq":101');
  });

  it("reloads persisted state after the singleton is dropped (reload)", () => {
    updateDemoState((s) => ({ ...s, friends: s.friends.slice(0, 1) }));
    resetDemoState(); // sessionStorage is kept intact, which simulates a page reload.
    expect(getDemoState().friends).toHaveLength(1);
  });

  it("falls back to seed when persisted JSON is malformed", () => {
    sessionStorage.setItem("p0rt1on-demo-state", "{not json");
    resetDemoState();
    expect(getDemoState().friends).toHaveLength(4);
  });
});

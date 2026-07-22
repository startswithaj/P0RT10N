import { describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import {
  bump,
  hourKey,
  hourlySeries,
  prune,
  sumLast24h,
} from "./requestBuckets.ts";

describe("requestBuckets", () => {
  it("bump records a request in its own hour bucket", () => {
    const b = bump({}, "2026-06-30T10:15:00Z", "2026-06-30T10:20:00Z");
    expect(b[hourKey("2026-06-30T10:00:00Z")]).toBe(1);
    expect(sumLast24h(b, "2026-06-30T10:20:00Z")).toBe(1);
  });

  it("bump accumulates within the same hour", () => {
    let b = bump({}, "2026-06-30T10:05:00Z", "2026-06-30T10:05:00Z");
    b = bump(b, "2026-06-30T10:45:00Z", "2026-06-30T10:45:00Z");
    expect(b[hourKey("2026-06-30T10:00:00Z")]).toBe(2);
  });

  it("sumLast24h counts only buckets inside the 24h window", () => {
    const buckets = {
      [hourKey("2026-06-30T09:00:00Z")]: 5, // in window
      [hourKey("2026-06-29T12:00:00Z")]: 3, // in window (21h earlier)
      [hourKey("2026-06-29T08:00:00Z")]: 9, // out of window (25h earlier)
    };
    expect(sumLast24h(buckets, "2026-06-30T09:30:00Z")).toBe(8);
  });

  it("the count decays as the clock advances past old buckets", () => {
    const buckets = { [hourKey("2026-06-30T10:00:00Z")]: 4 };
    expect(sumLast24h(buckets, "2026-06-30T11:00:00Z")).toBe(4); // 1h later
    expect(sumLast24h(buckets, "2026-07-01T11:00:00Z")).toBe(0); // 25h later
  });

  it("bump prunes buckets that have aged out of the window", () => {
    const stale = { [hourKey("2026-06-29T08:00:00Z")]: 9 };
    // A new request ~26h later drops the stale bucket entirely.
    const b = bump(stale, "2026-06-30T10:00:00Z", "2026-06-30T10:00:00Z");
    expect(hourKey("2026-06-29T08:00:00Z") in b).toBe(false);
    expect(sumLast24h(b, "2026-06-30T10:00:00Z")).toBe(1);
  });

  it("prune drops future-dated buckets (skewed webhook timestamps)", () => {
    const buckets = {
      [hourKey("2026-06-30T09:00:00Z")]: 5, // in window
      [hourKey("2026-07-01T12:00:00Z")]: 7, // +26h in the future
    };
    const now = "2026-06-30T10:00:00Z";
    expect(prune(buckets, now)).toEqual({
      [hourKey("2026-06-30T09:00:00Z")]: 5,
    });
    // And a future-dated event bumped in never survives the write-path prune.
    const b = bump({}, "2026-07-01T12:00:00Z", now);
    expect(sumLast24h(b, now)).toBe(0);
  });

  it("tolerates an unparseable clock without dropping data", () => {
    const buckets = { [hourKey("2026-06-30T10:00:00Z")]: 2 };
    expect(prune(buckets, "not-a-date")).toEqual(buckets);
    expect(sumLast24h(buckets, "not-a-date")).toBe(2);
  });

  it("hourlySeries returns a fixed 24-length window, oldest→newest", () => {
    const buckets = {
      [hourKey("2026-06-30T10:00:00Z")]: 4, // newest (index 23)
      [hourKey("2026-06-30T09:00:00Z")]: 1, // index 22
      [hourKey("2026-06-29T11:00:00Z")]: 9, // oldest in window (index 0)
      [hourKey("2026-06-29T08:00:00Z")]: 7, // out of window → excluded
    };
    const s = hourlySeries(buckets, "2026-06-30T10:30:00Z");
    expect(s.length).toBe(24);
    expect(s[0]).toBe(9);
    expect(s[22]).toBe(1);
    expect(s[23]).toBe(4);
    // Every other slot is a zero-filled gap, and the stale bucket is absent.
    expect(s.reduce((a, b) => a + b, 0)).toBe(14);
  });

  it("hourlySeries is empty when the clock is unparseable", () => {
    expect(hourlySeries({ [hourKey("2026-06-30T10:00:00Z")]: 2 }, "nope"))
      .toEqual([]);
  });
});

import { describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { subscription } from "./MinioEventSubscription.ts";

describe("MinioEventSubscription", () => {
  async function* nums() {
    yield* [1, 2, 3];
  }

  async function* double(src: AsyncIterable<number>) {
    // deno-lint-ignore custom-no-imperative-loops/no-imperative-loops
    for await (const n of src) yield n * 2;
  }

  it("pipe transforms the stream and carries the same signal", async () => {
    const ac = new AbortController();
    const sub = subscription(nums(), ac.signal).pipe(double);
    expect(sub.signal).toBe(ac.signal);
    expect(await Array.fromAsync(sub.events)).toEqual([2, 4, 6]);
  });

  it("pipe is chainable, applying transforms in order", async () => {
    const ac = new AbortController();
    const sub = subscription(nums(), ac.signal).pipe(double).pipe(double);
    expect(await Array.fromAsync(sub.events)).toEqual([4, 8, 12]);
  });
});

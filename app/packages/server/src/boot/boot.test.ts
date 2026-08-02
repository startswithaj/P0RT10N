import { describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { FakeTime } from "@std/testing/time";
import { runBoot } from "./boot.ts";

describe("runBoot", () => {
  it("runs migrate → recover → reconcile → sweep → preflight, then serves", async () => {
    const order: string[] = [];

    const step = (name: string) => () => {
      order.push(name);
      return Promise.resolve();
    };

    await runBoot({
      migrate: () => {
        order.push("migrate");
      },
      recoverStaleProvisioning: step("recover"),
      reconcile: step("reconcile"),
      sweep: step("sweep"),
      preflight: step("preflight"),
      serve: () => {
        order.push("serve");
      },
    });

    expect(order).toEqual([
      "migrate",
      "recover",
      "reconcile",
      "sweep",
      "preflight",
      "serve",
    ]);
  });

  it("serve waits for a slow reconcile (listeners never race recovery)", async () => {
    const order: string[] = [];
    // FakeTime drives the setTimeout below virtually, so the "slow" reconcile
    // proves real await ordering without a wall-clock wait.
    using time = new FakeTime();

    const booted = runBoot({
      migrate: () => {},
      recoverStaleProvisioning: () => Promise.resolve(),
      reconcile: () =>
        new Promise((resolve) =>
          setTimeout(() => {
            order.push("reconcile");
            resolve(undefined);
          }, 10)
        ),
      sweep: () => Promise.resolve(),
      preflight: () => Promise.resolve(),
      serve: () => {
        order.push("serve");
      },
    });

    await time.tickAsync(10);
    await booted;

    expect(order).toEqual(["reconcile", "serve"]);
  });
});

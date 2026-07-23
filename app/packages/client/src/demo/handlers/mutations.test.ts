import { beforeEach, describe, expect, it } from "vitest";
import { mutationHandlers } from "./mutations.ts";
import { getDemoState, resetDemoState } from "../state.ts";

describe("demo mutation handlers", () => {
  const m = (path: string, input: unknown): unknown => {
    const fns = mutationHandlers as unknown as Record<
      string,
      (input: unknown) => unknown
    >;
    const handler = fns[path];
    if (!handler) throw new Error(`no mutation handler for ${path}`);
    return handler(input);
  };

  const addInput = (name: string) => ({
    name,
    quotaBytes: 50_000_000_000,
    retentionDays: 30,
    isolationMode: "dedicated",
    enrollment: { mode: "authKey" },
  });

  const friendById = (id: number) =>
    getDemoState().friends.find((f) => f.id === id);

  beforeEach(() => {
    sessionStorage.clear();
    resetDemoState();
  });

  it("resize updates the quota and returns the detail", () => {
    const d = m("friends.resize", {
      friendId: 1,
      quotaBytes: 200_000_000_000,
    }) as { usage: { quotaBytes: number } };
    expect(d.usage.quotaBytes).toBe(200_000_000_000);
    expect(friendById(1)?.usage.quotaBytes).toBe(200_000_000_000);
  });

  it("suspend flips status and records an audit row", () => {
    const before = getDemoState().audit.length;
    const d = m("friends.suspend", { friendId: 1 }) as { status: string };
    expect(d.status).toBe("suspended");
    expect(getDemoState().audit.length).toBe(before + 1);
  });

  it("resume reactivates a suspended friend", () => {
    m("friends.suspend", { friendId: 1 });
    expect((m("friends.resume", { friendId: 1 }) as { status: string }).status)
      .toBe("active");
  });

  it("offboard removes the friend and returns ok", () => {
    expect((m("friends.offboard", { friendId: 1 }) as { ok: boolean }).ok).toBe(
      true,
    );
    expect(friendById(1)).toBeUndefined();
  });

  it("rotateKey returns a bundle with no Tailscale fields", () => {
    const b = m("friends.rotateKey", { friendId: 1 }) as {
      s3SecretKey: string;
      tsAuthKey?: string;
    };
    expect(b.s3SecretKey).toBeTruthy();
    expect(b.tsAuthKey).toBeUndefined();
  });

  it("reissueTsKey returns a matching key + up command", () => {
    const b = m("friends.reissueTsKey", { friendId: 1 }) as {
      tsAuthKey: string;
      tailscaleUpCommand: string;
    };
    expect(b.tsAuthKey).toContain("tskey-auth-demo");
    expect(b.tailscaleUpCommand).toContain(b.tsAuthKey);
  });

  it("addStart stashes a job + claimable bundle without adding the friend", () => {
    const { jobId } = m("friends.addStart", addInput("eve")) as {
      jobId: string;
    };
    expect(getDemoState().jobs[jobId]).toBeDefined();
    expect(getDemoState().friends.find((f) => f.name === "eve"))
      .toBeUndefined();
    expect((m("jobs.claimBundle", { jobId }) as { name: string }).name).toBe(
      "eve",
    );
  });

  it("claimBundle is single-shot", () => {
    const { jobId } = m("friends.addStart", addInput("eve")) as {
      jobId: string;
    };
    m("jobs.claimBundle", { jobId });
    expect(() => m("jobs.claimBundle", { jobId })).toThrow();
  });

  it("offboardStart creates an offboard job for an existing friend", () => {
    const { jobId } = m("friends.offboardStart", { friendId: 1 }) as {
      jobId: string;
    };
    expect(getDemoState().jobs[jobId]?.kind).toBe("offboard");
  });

  it("add (sync) provisions and returns a bundle", () => {
    const b = m("friends.add", addInput("frank")) as { name: string };
    expect(b.name).toBe("frank");
    expect(getDemoState().friends.find((f) => f.name === "frank"))
      .toBeDefined();
  });
});

import { beforeEach, describe, expect, it } from "vitest";
import { queryHandlers } from "./queries.ts";
import { getDemoState, resetDemoState } from "../state.ts";

describe("demo query handlers", () => {
  const q = (path: string, input: unknown = {}): unknown => {
    const handler = queryHandlers[path];
    if (!handler) throw new Error(`no query handler for ${path}`);
    return handler(input, getDemoState());
  };

  beforeEach(() => {
    sessionStorage.clear();
    resetDemoState();
  });

  it("auth.status reports auth disabled (skips login)", () => {
    expect(q("auth.status")).toEqual({ enabled: false, authenticated: true });
  });

  it("friends.list returns one row per friend", () => {
    expect((q("friends.list") as unknown[]).length).toBe(4);
  });

  it("friends.get returns the detail for an id", () => {
    expect((q("friends.get", { friendId: 1 }) as { name: string }).name).toBe(
      "alice",
    );
  });

  it("friends.capabilities advertises invites", () => {
    expect(q("friends.capabilities")).toEqual({ inviteApiConfigured: true });
  });

  it("status.get groups minio rows per friend + a host row", () => {
    const s = q("status.get") as { minio: unknown[]; host: unknown[] };
    expect(s.minio).toHaveLength(4);
    expect(s.host).toHaveLength(1);
  });

  it("audit.list pages newest-first and honours the limit", () => {
    const rows = q("audit.list", { limit: 2 }) as Array<{ id: number }>;
    expect(rows).toHaveLength(2);
    expect(rows[0].id).toBeGreaterThan(rows[1].id);
  });

  it("audit.list pages older rows via the before cursor", () => {
    const rows = q("audit.list", { limit: 10, before: 3 }) as Array<
      { id: number }
    >;
    expect(rows.every((r) => r.id < 3)).toBe(true);
  });

  it("status.diagnose echoes the instance name and a healthy shape", () => {
    const d = q("status.diagnose", { instanceName: "alice-minio" }) as {
      name: string;
      health: string;
    };
    expect(d.name).toBe("alice-minio");
    expect(d.health).toBe("healthy");
  });

  it("usage.history returns the friend's latest sample", () => {
    expect((q("usage.history", { friendId: 1 }) as unknown[]).length).toBe(1);
  });

  it("activity.current returns the friend's activity", () => {
    const a = q("activity.current", { friendId: 2 }) as {
      requestsTotal: number;
    };
    expect(a.requestsTotal).toBeGreaterThan(0);
  });
});

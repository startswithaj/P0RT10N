import { describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { createCallerFactory } from "../trpc.ts";
import type { TrpcContext } from "../trpc.ts";
import { appRouter } from "../root.ts";
import { AdminAuth } from "../../auth/AdminAuth.ts";
import { noopLogger } from "../../test-helpers/mocks.ts";
import type { ActivityView } from "@p0rt1on/shared/domain";

describe("activity router", () => {
  const view: ActivityView = {
    requestsTotal: 3,
    requestsByOp: { GetObject: 3 },
    requests24h: 3,
    lastRequestAt: "2026-07-24T00:00:00.000Z",
    lastOp: "GetObject",
    bytesInTotal: 10,
    bytesOutTotal: 20,
    deniedCount: 0,
    updatedAt: "2026-07-24T00:00:00.000Z",
  };

  // auth disabled → protectedProcedure passes straight through; the router only
  // touches ctx.activityService.
  const ctxFor = (): TrpcContext =>
    ({
      auth: AdminAuth.disabled(),
      logger: noopLogger(),
      responseHeaders: new Headers(),
      activityService: {
        current: () => Promise.resolve(view),
        stream: async function* () {
          yield view;
        },
      },
    }) as unknown as TrpcContext;

  const call = createCallerFactory(appRouter);

  it("current returns the service's current aggregate", async () => {
    const got = await call(ctxFor()).activity.current({ friendId: 1 });
    expect(got).toEqual(view);
  });

  it("stream yields the service's activity iterable", async () => {
    const iter = await call(ctxFor()).activity.stream({ friendId: 1 });
    const out = await Array.fromAsync(iter);
    expect(out).toEqual([view]);
  });
});

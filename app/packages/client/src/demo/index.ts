import { TRPCClientError, type TRPCLink } from "@trpc/client";
import { observable } from "@trpc/server/observable";
import type { AppRouter } from "@p0rt1on/server/router";
import {
  resolveDemoMutation,
  resolveDemoQuery,
  resolveDemoSubscription,
} from "./dispatch.ts";

/**
 * Terminating tRPC link for demo mode: queries and mutations resolve synchronously from in-memory state, and subscriptions push events over timers.
 * It replaces the real http batch and subscription links, so every call site elsewhere in the app stays unchanged.
 */
export const demoLink = (): TRPCLink<AppRouter> => () => ({ op }) =>
  observable((observer) => {
    if (op.type === "subscription") {
      observer.next({ result: { type: "started" } });
      return resolveDemoSubscription(op.path, op.input, {
        data: (value) =>
          observer.next({ result: { type: "data", data: value } }),
        error: (err) => observer.error(TRPCClientError.from(err as Error)),
        complete: () => observer.complete(),
      });
    }
    try {
      const data = op.type === "mutation"
        ? resolveDemoMutation(op.path, op.input)
        : resolveDemoQuery(op.path, op.input);
      observer.next({ result: { data } });
      observer.complete();
    } catch (err) {
      observer.error(TRPCClientError.from(err as Error));
    }
    return () => {};
  });

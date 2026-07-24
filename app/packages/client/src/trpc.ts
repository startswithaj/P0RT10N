import {
  createTRPCClient,
  httpBatchLink,
  httpSubscriptionLink,
  splitLink,
} from "@trpc/client";
import { QueryCache, QueryClient } from "@tanstack/solid-query";
import type { AppRouter } from "@p0rt1on/server/router";
import { demoLink } from "./demo/index.ts";

// Inline literal so Vite folds it to a constant and tree-shakes the ./demo engine out of production.
const DEMO = import.meta.env.VITE_DEMO_MODE === "1";

// Network transport: splitLink routes subscriptions (jobs.progress) over SSE, everything else batches over HTTP POST. Built lazily so demo builds skip it.
const networkLinks = () => [
  splitLink({
    condition: (op) => op.type === "subscription",
    // Subscriptions are pure observers (jobs.progress replays + follows a background job); work starts via mutations only, so EventSource reconnect is safe — re-attaches and replays, never re-runs. Failures arrive as `error` data events.
    true: httpSubscriptionLink({ url: "/trpc" }),
    false: httpBatchLink({ url: "/trpc" }),
  }),
];

// Vanilla tRPC proxy client (typed by AppRouter) used inside TanStack Query's queryFn. In demo mode a terminating demoLink replaces network links, resolving from in-browser state so the SPA runs with no backend.
export const trpc = createTRPCClient<AppRouter>({
  links: DEMO ? [demoLink()] : networkLinks(),
});

/** A tRPC error whose code is UNAUTHORIZED (session missing/expired). */
function isUnauthorized(err: unknown): boolean {
  return (err as { data?: { code?: string } })?.data?.code === "UNAUTHORIZED";
}

export const queryClient = new QueryClient({
  // A session that expired mid-use → refetch auth so the app gates to login.
  queryCache: new QueryCache({
    onError: (err) => {
      if (isUnauthorized(err)) {
        queryClient.invalidateQueries({ queryKey: ["auth"] });
      }
    },
  }),
});

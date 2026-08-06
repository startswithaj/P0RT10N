import {
  createTRPCClient,
  httpBatchLink,
  httpLink,
  httpSubscriptionLink,
  splitLink,
} from "@trpc/client";
import { QueryCache, QueryClient } from "@tanstack/solid-query";
import type { AppRouter } from "@p0rt1on/server/router";
import { demoLink } from "./demo/index.ts";

// This is an inline literal so Vite folds it to a constant and tree-shakes the demo engine out of production.
const DEMO = import.meta.env.VITE_DEMO_MODE === "1";

const UNBATCHED = new Set<string>(["friends.hostnameWarnings"]);

// splitLink routes subscriptions like jobs.progress over SSE and batches everything
// else over HTTP POST; this is built lazily so demo builds can skip it entirely.
const networkLinks = () => [
  splitLink({
    condition: (op) => op.type === "subscription",
    // Subscriptions are pure observers of a background job that only mutations start, so an
    // EventSource reconnect is safe: it re-attaches and replays instead of re-running the job.
    true: httpSubscriptionLink({ url: "/trpc" }),
    false: splitLink({
      condition: (op) => UNBATCHED.has(op.path),
      true: httpLink({ url: "/trpc" }),
      false: httpBatchLink({ url: "/trpc" }),
    }),
  }),
];

// This is a vanilla tRPC proxy client used inside TanStack Query's queryFn. In demo mode,
// a terminating demoLink replaces the network links and resolves from in-browser state, so the SPA runs without a backend.
export const trpc = createTRPCClient<AppRouter>({
  links: DEMO ? [demoLink()] : networkLinks(),
});

function isUnauthorized(err: unknown): boolean {
  return (err as { data?: { code?: string } })?.data?.code === "UNAUTHORIZED";
}

export const queryClient = new QueryClient({
  // When a session expires mid-use, this refetches auth so the app gates back to login.
  queryCache: new QueryCache({
    onError: (err) => {
      if (isUnauthorized(err)) {
        queryClient.invalidateQueries({ queryKey: ["auth"] });
      }
    },
  }),
});

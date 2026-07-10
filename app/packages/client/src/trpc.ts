import {
  createTRPCClient,
  httpBatchLink,
  httpSubscriptionLink,
  splitLink,
} from "@trpc/client";
import { QueryCache, QueryClient } from "@tanstack/solid-query";
import type { AppRouter } from "@p0rt1on/server/router";

// Vanilla tRPC proxy client (typed by AppRouter) used inside TanStack Solid
// Query's queryFn — the version-stable Solid integration. e.g.
//   createQuery(() => ({ queryKey: ["friends"], queryFn: () => trpc.friends.list.query() }))
//
// splitLink routes subscriptions (friends.addStream / offboardStream) over SSE
// via httpSubscriptionLink; everything else batches over plain HTTP POST.
export const trpc = createTRPCClient<AppRouter>({
  links: [
    splitLink({
      condition: (op) => op.type === "subscription",
      // Subscriptions are pure OBSERVERS (jobs.progress replays + follows a
      // background job) — work is started by mutations only, so EventSource's
      // built-in reconnect is safe here: it re-attaches and replays, never
      // re-runs. Failures arrive as `error` DATA events, not stream errors.
      true: httpSubscriptionLink({ url: "/trpc" }),
      false: httpBatchLink({ url: "/trpc" }),
    }),
  ],
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

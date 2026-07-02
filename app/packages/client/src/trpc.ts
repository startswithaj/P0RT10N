import {
  createTRPCClient,
  httpBatchLink,
  httpSubscriptionLink,
  splitLink,
} from "@trpc/client";
import { QueryClient } from "@tanstack/solid-query";
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
      true: httpSubscriptionLink({ url: "/trpc" }),
      false: httpBatchLink({ url: "/trpc" }),
    }),
  ],
});

export const queryClient = new QueryClient();

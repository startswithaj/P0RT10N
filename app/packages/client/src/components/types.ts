import { trpc } from "../trpc.ts";

/** hostnameWarning is merged in from its own query, not carried by friends.list. */
export type FriendRow =
  & Awaited<ReturnType<typeof trpc.friends.list.query>>[number]
  & { hostnameWarning: string | null };

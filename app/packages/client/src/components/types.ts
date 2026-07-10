import { trpc } from "../trpc.ts";

export type FriendRow = Awaited<
  ReturnType<typeof trpc.friends.list.query>
>[number];

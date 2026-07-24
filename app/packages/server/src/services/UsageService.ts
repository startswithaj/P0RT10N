import type { UsageView } from "@p0rt1on/shared/domain";
import type { FriendQueries } from "../db/FriendQueries.ts";
import type { UsageService } from "./types.ts";

/** Read-side wrapper over FriendQueries: a friend's usage history. */
export class UsageServiceImpl implements UsageService {
  constructor(private readonly queries: FriendQueries) {}

  history(friendId: number, limit: number): Promise<UsageView[]> {
    return this.queries.usageHistory(friendId, limit);
  }
}

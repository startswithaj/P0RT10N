import type { ActivityView } from "@p0rt1on/shared/domain";
import type { FriendQueries } from "../db/FriendQueries.ts";
import type { ActivityService } from "./types.ts";

export class ActivityServiceImpl implements ActivityService {
  constructor(private readonly queries: FriendQueries) {}

  current(friendId: number): Promise<ActivityView> {
    return this.queries.activityFor(friendId);
  }
}

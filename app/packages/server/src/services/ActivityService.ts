import type { ActivityView } from "@p0rt1on/shared/domain";
import type { FriendQueries } from "../db/FriendQueries.ts";
import { NotImplementedError } from "../lib/ServiceError.ts";
import type { ActivityService } from "./types.ts";

// TODO: wire `stream` to the audit-event bus / aggregator; currently unimplemented.
export class ActivityServiceImpl implements ActivityService {
  constructor(private readonly queries: FriendQueries) {}

  current(friendId: number): Promise<ActivityView> {
    return this.queries.activityFor(friendId);
  }

  // TODO: implement the live stream; until then return an iterable that throws
  // on iteration so the subscription errors.
  stream(_friendId: number, _signal: AbortSignal): AsyncIterable<ActivityView> {
    return {
      [Symbol.asyncIterator]() {
        throw new NotImplementedError(
          "ActivityService.stream not implemented",
        );
      },
    };
  }
}

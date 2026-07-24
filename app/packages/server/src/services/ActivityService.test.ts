import { describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { ActivityServiceImpl } from "./ActivityService.ts";
import { FriendQueries } from "../db/FriendQueries.ts";
import { createTestDatabase } from "../test-helpers/testDb.ts";

describe("ActivityServiceImpl.stream", () => {
  it("throws NOT_IMPLEMENTED when iterated", () => {
    const database = createTestDatabase();
    const svc = new ActivityServiceImpl(new FriendQueries(database.db));
    const iterable = svc.stream(1, new AbortController().signal);
    expect(() => iterable[Symbol.asyncIterator]()).toThrow("not implemented");
    database.driver.close();
  });
});

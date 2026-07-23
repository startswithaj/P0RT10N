// Enforces that the demo accounts for EVERY procedure on the real router. Lives
// in devtools so it can import both the server router (for the real paths) and
// the client's demo handler maps. Add or remove a procedure anywhere and this
// fails until it is handled. GATED is empty — every path must have a handler.

import { describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { appRouter } from "@p0rt1on/server/router";
import { queryHandlers } from "../app/packages/client/src/demo/handlers/queries.ts";
import { mutationHandlers } from "../app/packages/client/src/demo/handlers/mutations.ts";
import { subscriptionHandlers } from "../app/packages/client/src/demo/handlers/subscriptions.ts";

describe("demo coverage", () => {
  const realPaths = (type: "query" | "mutation" | "subscription"): string[] => {
    const procedures = (appRouter as unknown as {
      _def: { procedures: Record<string, { _def: { type: string } }> };
    })._def.procedures;
    return Object.entries(procedures)
      .filter(([, p]) => p._def.type === type)
      .map(([path]) => path)
      .sort();
  };

  it("handles every query path", () => {
    expect(Object.keys(queryHandlers).sort()).toEqual(realPaths("query"));
  });

  it("handles every mutation path", () => {
    expect(Object.keys(mutationHandlers).sort()).toEqual(realPaths("mutation"));
  });

  it("handles every subscription path", () => {
    expect(Object.keys(subscriptionHandlers).sort()).toEqual(
      realPaths("subscription"),
    );
  });
});

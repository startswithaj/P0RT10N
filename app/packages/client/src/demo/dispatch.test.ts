import { beforeEach, describe, expect, it } from "vitest";
import {
  resolveDemoMutation,
  resolveDemoQuery,
  resolveDemoSubscription,
} from "./dispatch.ts";
import { DemoUnhandledError } from "./errors.ts";
import { resetDemoState } from "./state.ts";

beforeEach(() => {
  sessionStorage.clear();
  resetDemoState();
});

describe("demo dispatch", () => {
  it("routes a known query", () => {
    expect(resolveDemoQuery("auth.status", {})).toEqual({
      enabled: false,
      authenticated: true,
    });
  });

  it("throws DemoUnhandledError for an unknown query", () => {
    expect(() => resolveDemoQuery("nope.path", {})).toThrow(DemoUnhandledError);
  });

  it("throws DemoUnhandledError for an unknown mutation", () => {
    expect(() => resolveDemoMutation("nope.path", {})).toThrow(
      DemoUnhandledError,
    );
  });

  it("emits a DemoUnhandledError to an unknown subscription", () => {
    const errors: unknown[] = [];
    resolveDemoSubscription("nope.path", {}, {
      data: () => {},
      error: (e) => errors.push(e),
      complete: () => {},
    });
    expect(errors[0]).toBeInstanceOf(DemoUnhandledError);
  });
});

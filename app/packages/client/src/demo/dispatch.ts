import { DemoUnhandledError } from "./errors.ts";
import type { DemoState } from "./state.ts";
import { getDemoState } from "./state.ts";
import type { DemoEmitter } from "./handlers/types.ts";
import { queryHandlers } from "./handlers/queries.ts";
import { mutationHandlers } from "./handlers/mutations.ts";
import { subscriptionHandlers } from "./handlers/subscriptions.ts";

// The wire delivers an untyped string path; per-path typing lives in the total
// handler maps. Widen to one uniform signature at this dynamic boundary.
const queryFns = queryHandlers as unknown as Record<
  string,
  (input: unknown, state: DemoState) => unknown
>;

export const resolveDemoQuery = (path: string, input: unknown): unknown => {
  const handler = queryFns[path];
  if (!handler) throw new DemoUnhandledError("query", path);
  return handler(input, getDemoState());
};

// Untyped wire path; per-path typing lives in the total map. Widen at the dispatch boundary.
const mutationFns = mutationHandlers as unknown as Record<
  string,
  (input: unknown) => unknown
>;

export const resolveDemoMutation = (path: string, input: unknown): unknown => {
  const handler = mutationFns[path];
  if (!handler) throw new DemoUnhandledError("mutation", path);
  return handler(input);
};

const subscriptionFns = subscriptionHandlers as unknown as Record<
  string,
  (input: unknown, emit: DemoEmitter) => () => void
>;

export const resolveDemoSubscription = (
  path: string,
  input: unknown,
  emit: DemoEmitter,
): () => void => {
  const handler = subscriptionFns[path];
  if (!handler) {
    emit.error(new DemoUnhandledError("subscription", path));
    return () => {};
  }
  return handler(input, emit);
};

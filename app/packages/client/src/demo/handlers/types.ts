import type { DemoState } from "../state.ts";
import type {
  MutationInput,
  MutationOutput,
  MutationPath,
  QueryInput,
  QueryOutput,
  QueryPath,
  SubscriptionPath,
} from "../paths.ts";

/** A demo query handler, typed to its path's real input + (awaited) output. */
export type QueryHandler<P extends QueryPath> = (
  input: QueryInput<P>,
  state: DemoState,
) => QueryOutput<P>;

/** TOTAL over every query path — a missing handler or a return shape that drifts
 *  from the router's inferred output is a compile error. */
export type QueryHandlers = { [P in QueryPath]: QueryHandler<P> };

/** A demo mutation handler, typed to its path's real input + (awaited) output. */
export type MutationHandler<P extends MutationPath> = (
  input: MutationInput<P>,
) => MutationOutput<P>;

/** TOTAL over every mutation path (GATED is empty) — a missing handler, wrong
 *  return shape, or a new router mutation is a compile error. */
export type MutationHandlers = { [P in MutationPath]: MutationHandler<P> };

/** Simple time-based emitter — decouples handlers from tRPC's observer type. */
export interface DemoEmitter {
  data(value: unknown): void;
  error(err: unknown): void;
  complete(): void;
}

/** A subscription handler pushes over time and returns a teardown. */
export type SubscriptionHandler = (
  input: unknown,
  emit: DemoEmitter,
) => () => void;

/** TOTAL over every subscription path. */
export type SubscriptionHandlers = {
  [P in SubscriptionPath]: SubscriptionHandler;
};

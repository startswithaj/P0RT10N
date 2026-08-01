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

/** A demo query handler, typed to its path's real input and awaited output type from the actual router. */
export type QueryHandler<P extends QueryPath> = (
  input: QueryInput<P>,
  state: DemoState,
) => QueryOutput<P>;

/** This type is total over every query path, so a missing handler or an output
 *  shape that drifts from the router's inferred type is a compile error. */
export type QueryHandlers = { [P in QueryPath]: QueryHandler<P> };

/** A demo mutation handler, typed to its path's real input and awaited output type from the actual router. */
export type MutationHandler<P extends MutationPath> = (
  input: MutationInput<P>,
) => MutationOutput<P>;

/** This type is total over every mutation path, so a missing handler, a wrong
 *  return shape, or a new router mutation is a compile error. */
export type MutationHandlers = { [P in MutationPath]: MutationHandler<P> };

/** A simple time-based emitter that decouples handlers from tRPC's observer type. */
export interface DemoEmitter {
  data(value: unknown): void;
  error(err: unknown): void;
  complete(): void;
}

export type SubscriptionHandler = (
  input: unknown,
  emit: DemoEmitter,
) => () => void;

/** This type is total over every subscription path. */
export type SubscriptionHandlers = {
  [P in SubscriptionPath]: SubscriptionHandler;
};

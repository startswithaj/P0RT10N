// These types come purely from a type-only import of the real AppRouter, keeping
// server code out of the client bundle; if the installed @trpc/server changes the internal _def.record shape this walks, fix it here.

import type {
  AnyMutationProcedure,
  AnyProcedure,
  AnyQueryProcedure,
  inferProcedureInput,
  inferProcedureOutput,
} from "@trpc/server";
import type { AppRouter } from "@p0rt1on/server/router";

type Rec = AppRouter["_def"]["record"];

type QueryPathsOf<T> = {
  [K in keyof T & string]: T[K] extends AnyQueryProcedure ? K
    : T[K] extends AnyProcedure ? never
    : T[K] extends object ? `${K}.${QueryPathsOf<T[K]>}`
    : never;
}[keyof T & string];

type MutationPathsOf<T> = {
  [K in keyof T & string]: T[K] extends AnyMutationProcedure ? K
    : T[K] extends AnyProcedure ? never
    : T[K] extends object ? `${K}.${MutationPathsOf<T[K]>}`
    : never;
}[keyof T & string];

// A subscription is any procedure that is neither a query nor a mutation.
type SubscriptionPathsOf<T> = {
  [K in keyof T & string]: T[K] extends AnyMutationProcedure ? never
    : T[K] extends AnyQueryProcedure ? never
    : T[K] extends AnyProcedure ? K
    : T[K] extends object ? `${K}.${SubscriptionPathsOf<T[K]>}`
    : never;
}[keyof T & string];

export type QueryPath = QueryPathsOf<Rec>;
export type MutationPath = MutationPathsOf<Rec>;
export type SubscriptionPath = SubscriptionPathsOf<Rec>;

type ProcedureAt<T, P extends string> = P extends `${infer H}.${infer R}`
  ? H extends keyof T ? ProcedureAt<T[H], R> : never
  : P extends keyof T ? T[P]
  : never;

export type MutationInput<P extends MutationPath> = inferProcedureInput<
  ProcedureAt<Rec, P>
>;
export type MutationOutput<P extends MutationPath> = inferProcedureOutput<
  ProcedureAt<Rec, P>
>;
export type QueryInput<P extends QueryPath> = inferProcedureInput<
  ProcedureAt<Rec, P>
>;
export type QueryOutput<P extends QueryPath> = inferProcedureOutput<
  ProcedureAt<Rec, P>
>;

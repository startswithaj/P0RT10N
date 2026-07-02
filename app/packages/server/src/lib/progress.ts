// Progress events streamed by the add/offboard SSE subscriptions. The service
// methods are async generators that `yield` a StepEvent as each step begins and
// a final `{ type: "done" }` carrying the result; a throw between yields exits
// the generator, so the subscription errors on the exact failing step. Steps are
// named by an enum key (see PROVISION_STEPS / OFFBOARD_STEPS in shared/domain),
// so nothing depends on the order or count of yields.

export type StepEvent<K> = { type: "step"; step: K };

export type ProgressEvent<K, R> = StepEvent<K> | { type: "done"; result: R };

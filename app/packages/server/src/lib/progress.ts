// Steps are keyed by enum, not order or count, so a throw between yields exits the
// generator and the subscription errors on exactly the failing step.

export type StepEvent<K> = { type: "step"; step: K };

export type ProgressEvent<K, R> = StepEvent<K> | { type: "done"; result: R };

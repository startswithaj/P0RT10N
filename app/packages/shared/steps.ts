// Progress-step definitions for the add/offboard flows. Kept in their own
// module (no zod / no other deps) so the client can import these runtime values
// for the progress checklists without pulling the rest of `domain` — and its
// zod schemas — into the browser bundle. Re-exported from `domain` for the
// server's convenience.
//
// The add/offboard flows stream progress over SSE (friends.addStream /
// friends.offboardStream). Each event names its step by `key`; the server passes
// these keys to the generator's `yield`, and the client renders the ordered list
// below, marking the reported step active and earlier ones done. Order here =
// display order; the keys are the wire contract between server and client.

/** One checklist step: a stable `key` (the wire contract) + display `label`. */
export type ProgressStep<K extends string> = { key: K; label: string };

/** Add-friend provisioning steps, in execution order (authkey label varies by enroll). */
export const PROVISION_STEPS = [
  { key: "instance", label: "Starting MinIO instance" },
  { key: "tailnet", label: "Configuring tailnet access" },
  { key: "authkey", label: "Minting Tailscale auth key" }, // "invite": swapped client-side
  { key: "bucket", label: "Creating bucket & S3 user" },
  { key: "smoke", label: "Running smoke test" },
  { key: "retention", label: "Arming retention & quota" },
  { key: "finalize", label: "Finalizing" },
] as const satisfies ProgressStep<string>[];
export type ProvisionStepKey = (typeof PROVISION_STEPS)[number]["key"];

/** Offboard teardown steps, in execution order. */
export const OFFBOARD_STEPS = [
  { key: "storage", label: "Removing S3 user & bucket" },
  { key: "nodes", label: "Revoking Tailscale nodes" },
  { key: "acl", label: "Removing tailnet ACL" },
  { key: "record", label: "Deleting record" },
  { key: "reap", label: "Reaping instance" },
] as const satisfies ProgressStep<string>[];
export type OffboardStepKey = (typeof OFFBOARD_STEPS)[number]["key"];

// The array order below is the display order, and each step's `key` is the
// wire contract that the server and client must agree on.

export type ProgressStep<K extends string> = { key: K; label: string };

export const PROVISION_STEPS = [
  { key: "instance", label: "Starting MinIO instance" },
  { key: "tailnet", label: "Configuring tailnet access" },
  { key: "authkey", label: "Minting Tailscale auth key" }, // the client swaps this label when enrollment mode is invite
  { key: "bucket", label: "Creating bucket & S3 user" },
  { key: "smoke", label: "Running smoke test" },
  { key: "retention", label: "Arming retention & quota" },
  { key: "finalize", label: "Finalizing" },
] as const satisfies ProgressStep<string>[];
export type ProvisionStepKey = (typeof PROVISION_STEPS)[number]["key"];

/**
 * Failures travel as `error` events, not stream errors, so a dropped
 * connection can safely reconnect and replay without re-running work. `done`
 * never carries the bundle; secrets are handed over exactly once via the
 * separate `jobs.claimBundle` mutation.
 */
export type JobProgressEvent =
  | { type: "step"; step: string }
  | { type: "error"; message: string; step: string | null }
  | { type: "done"; bundleReady: boolean; manualAclCleanup?: string }; // manualAclCleanup is advisory plain text, not a secret

export const OFFBOARD_STEPS = [
  { key: "storage", label: "Removing S3 user & bucket" },
  { key: "nodes", label: "Revoking Tailscale nodes" },
  { key: "acl", label: "Removing tailnet ACL" },
  { key: "record", label: "Deleting record" },
  { key: "reap", label: "Reaping instance" },
] as const satisfies ProgressStep<string>[];
export type OffboardStepKey = (typeof OFFBOARD_STEPS)[number]["key"];

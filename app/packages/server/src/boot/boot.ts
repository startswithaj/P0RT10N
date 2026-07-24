// ============================================================================
// The boot sequence, extracted from main.ts so the ORDER is testable:
// migrations → fail stale provisioning → container reconcile → sweep →
// listeners. Every recovery step completes before serve, so no request can
// observe half-reconciled state, and recovery happens on the boot that
// needed it — not a sweep-interval later.
// ============================================================================

export interface BootSteps {
  /** Apply pending DB migrations. */
  migrate(): void;
  /** Flip crashed `provisioning` rows to failed. */
  recoverStaleProvisioning(): Promise<unknown>;
  /** Compare DB instances against real containers; start/verify/mark. */
  reconcile(): Promise<unknown>;
  /** Reap failed-provision tombstones. */
  sweep(): Promise<unknown>;
  /** Probe tailnet prerequisites (MagicDNS, serve tag) so the UI can gate
   * portion creation. Loud but never fatal — the admin UI must come up to
   * SHOW the problem. */
  preflight(): Promise<unknown>;
  /** Start the HTTP listeners (and any recurring timers). */
  serve(): void;
}

export async function runBoot(steps: BootSteps): Promise<void> {
  steps.migrate();
  await steps.recoverStaleProvisioning();
  await steps.reconcile();
  await steps.sweep();
  await steps.preflight();
  steps.serve();
}

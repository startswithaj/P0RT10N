// Boot sequence extracted so the ORDER is testable: migrate → fail stale
// provisioning → reconcile → sweep → serve. Every recovery step finishes
// before serve, so no request sees half-reconciled state.

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

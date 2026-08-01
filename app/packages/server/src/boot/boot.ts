// The boot sequence is extracted so its order is testable, running migrate, then fail-stale-provisioning,
// then reconcile, then sweep, then serve. Every recovery step finishes before serve, so no request sees half-reconciled state.

export interface BootSteps {
  migrate(): void;
  recoverStaleProvisioning(): Promise<unknown>;
  reconcile(): Promise<unknown>;
  sweep(): Promise<unknown>;
  // Preflight is loud but never fatal, since the admin UI must still come up to show the problem.
  preflight(): Promise<unknown>;
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

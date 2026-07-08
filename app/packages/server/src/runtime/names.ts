// Deterministic container + volume names for an instance, derived from its
// tailnet hostname. Shared by ProvisioningService (builds the spec) and the
// runtime (stop/remove by instance name) so the two never disagree.

export interface ContainerNames {
  container: string;
  /** Single data volume — MinIO SNSD supports Object Lock; no erasure set. */
  dataVolume: string;
  /**
   * The pre-SNSD 4-volume names. Kept ONLY so teardown reaps instances
   * created before the single-drive switch; never mounted for new ones.
   */
  legacyDataVolumes: string[];
  stateVolume: string;
}

export function containerNames(instanceHost: string): ContainerNames {
  return {
    container: `p0rt1on-instance-${instanceHost}`,
    dataVolume: `p0rt1on-data-${instanceHost}`,
    legacyDataVolumes: [1, 2, 3, 4].map((n) =>
      `p0rt1on-data-${instanceHost}-${n}`
    ),
    stateVolume: `p0rt1on-tsstate-${instanceHost}`,
  };
}

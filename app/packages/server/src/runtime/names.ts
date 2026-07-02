// Deterministic container + volume names for an instance, derived from its
// tailnet hostname. Shared by ProvisioningService (builds the spec) and the
// runtime (stop/remove by instance name) so the two never disagree.

export interface ContainerNames {
  container: string;
  /** 4 data volumes — MinIO erasure needs >=4 distinct mounts for object lock. */
  dataVolumes: string[];
  stateVolume: string;
}

export function containerNames(instanceHost: string): ContainerNames {
  return {
    container: `p0rt1on-instance-${instanceHost}`,
    dataVolumes: [1, 2, 3, 4].map((n) => `p0rt1on-data-${instanceHost}-${n}`),
    stateVolume: `p0rt1on-tsstate-${instanceHost}`,
  };
}

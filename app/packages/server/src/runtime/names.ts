// Container and volume names are deterministically derived from the instance's tailnet hostname,
// and both ProvisioningService and the runtime rely on that so they never disagree on a name.

export interface ContainerNames {
  container: string;
  // There is a single data volume because MinIO's Object Lock support requires single-node
  // single-drive mode, which has no erasure set.
  dataVolume: string;
  // These are the pre-single-drive-switch four-volume names, kept only so teardown can reap
  // instances created before the switch; they are never mounted for new instances.
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

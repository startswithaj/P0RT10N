// The copy-paste snippet an admin adds to their Tailscale policy file when the
// manager can't edit it programmatically (no `policy_file` write scope). Grants
// the friend's tag access to ONLY its endpoint — the same rule ensureFriendAcl
// would have written. Shared by TailscaleHttpApi (auto-mode 403) and the
// provisioning flow (manual mode) so the instructions never drift.

/**
 * The offboard twin: what the admin should remove from their policy once the
 * friend is gone. Advisory only — the offboard has already completed. Names
 * the same entries manualAclInstructions told them to add, keyed by tag.
 */
export function manualAclRemovalInstructions(src: string): string {
  return [
    `Remove from your Tailscale policy (https://login.tailscale.com/admin/acls):`,
    ``,
    // A user-email src owns itself; only tag srcs have a tagOwners entry.
    ...(src.startsWith("tag:") ? [`- the "tagOwners" entry for "${src}"`] : []),
    `- any "grants" entry with "src": ["${src}"]`,
  ].join("\n");
}

export function manualAclInstructions(
  src: string,
  endpointHostPort: string,
  tagOwner: string,
): string {
  // `dst` is a bare hostname; the port lives in `ip` as `proto:port`.
  const colon = endpointHostPort.lastIndexOf(":");
  const host = colon > 0 ? endpointHostPort.slice(0, colon) : endpointHostPort;
  const port = colon > 0 ? endpointHostPort.slice(colon + 1) : "443";
  const grant = JSON.stringify(
    { src: [src], dst: [host], ip: [`tcp:${port}`] },
    null,
    2,
  );
  // Only a tag needs a tagOwners declaration; a user email owns itself.
  const tagOwnerLines = src.startsWith("tag:")
    ? [`"tagOwners": ${JSON.stringify({ [src]: [tagOwner] }, null, 2)},`, ``]
    : [];
  return [
    `Add to your Tailscale policy (https://login.tailscale.com/admin/acls):`,
    ``,
    ...tagOwnerLines,
    `"grants": [`,
    grant,
    `]`,
  ].join("\n");
}

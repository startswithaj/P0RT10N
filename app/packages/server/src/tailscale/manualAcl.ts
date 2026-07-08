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
export function manualAclRemovalInstructions(tag: string): string {
  return [
    `Remove from your Tailscale policy (https://login.tailscale.com/admin/acls):`,
    ``,
    `- the "tagOwners" entry for "${tag}"`,
    `- any "grants" entry with "src": ["${tag}"]`,
  ].join("\n");
}

export function manualAclInstructions(
  tag: string,
  endpointHostPort: string,
  tagOwner: string,
): string {
  // `dst` is a bare hostname; the port lives in `ip` as `proto:port`.
  const colon = endpointHostPort.lastIndexOf(":");
  const host = colon > 0 ? endpointHostPort.slice(0, colon) : endpointHostPort;
  const port = colon > 0 ? endpointHostPort.slice(colon + 1) : "443";
  const tagOwners = JSON.stringify({ [tag]: [tagOwner] }, null, 2);
  const grant = JSON.stringify(
    { src: [tag], dst: [host], ip: [`tcp:${port}`] },
    null,
    2,
  );
  return [
    `Add to your Tailscale policy (https://login.tailscale.com/admin/acls):`,
    ``,
    `"tagOwners": ${tagOwners},`,
    ``,
    `"grants": [`,
    grant,
    `]`,
  ].join("\n");
}

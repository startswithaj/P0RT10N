// Advisory instructions shown when the personal API token is unset or expired,
// so the invite flow degrades instead of failing. Mirrors manualAcl.ts: the
// manager can't act, so it tells the admin exactly what to do in the console.
// Plain text — never a secret.

const ADMIN_USERS = "https://login.tailscale.com/admin/users";

/** No-token add: how to invite the friend by hand (rides the bundle). */
export function manualInviteInstructions(email: string): string {
  return [
    `No Tailscale API token is configured, so no invite was sent.`,
    `Invite this friend manually (or set P0RT1ON_TAILSCALE_API_TOKEN):`,
    ``,
    `1. Open ${ADMIN_USERS}`,
    `2. Invite user → email: ${email}`,
    `3. Role: Member`,
  ].join("\n");
}

/** No-token offboard: how to remove a joined friend by hand (advisory). */
export function manualUserRemovalInstructions(email: string): string {
  return [
    `No Tailscale API token is configured, so the tailnet user was not removed.`,
    `If this friend accepted their invite, remove them manually:`,
    ``,
    `1. Open ${ADMIN_USERS}`,
    `2. Find ${email} → Delete user`,
  ].join("\n");
}

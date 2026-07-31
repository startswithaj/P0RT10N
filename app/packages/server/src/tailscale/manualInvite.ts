// When the personal API token is unset or expired, the invite flow degrades to
// these manual instructions instead of failing. They contain no secrets.

const ADMIN_USERS = "https://login.tailscale.com/admin/users";

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

/** Advisory: returned when the manager could not remove the tailnet user itself. */
export function manualUserRemovalInstructions(email: string): string {
  return [
    `No Tailscale API token is configured, so the tailnet user was not removed.`,
    `If this friend accepted their invite, remove them manually:`,
    ``,
    `1. Open ${ADMIN_USERS}`,
    `2. Find ${email} → Delete user`,
  ].join("\n");
}

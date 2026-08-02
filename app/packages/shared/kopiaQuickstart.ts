// The Kopia CLI snippet shown to a friend after add/rotate. Server and demo
// both build it from these, so the demo can never silently drift from
// production. Mirrors backup-client/entrypoint — keep the two in sync.

export interface KopiaCredential {
  accessKeyId: string;
  secretKey: string;
}

export function kopiaJoinLines(tailscaleUpCommand: string): string[] {
  return [
    "# Join the tailnet (redeems your single-use key):",
    tailscaleUpCommand,
    "",
  ];
}

export function kopiaInviteJoinLines(): string[] {
  return [
    "# After accepting the invite, generate an auth key in your Tailscale admin",
    "# console (https://login.tailscale.com/admin/settings/keys), then join:",
    "tailscale up --authkey=<your-tailscale-auth-key>",
    "",
  ];
}

export function kopiaCreateTail(retentionDays: number): string[] {
  return [
    `  --retention-mode=GOVERNANCE --retention-period=${retentionDays}d`,
    "",
    "# Then back up a directory (immutable for the retention window):",
    "kopia snapshot create /path/to/your/data",
  ];
}

export function buildKopiaQuickstart(opts: {
  endpoint: string;
  bucket: string;
  cred: KopiaCredential;
  retentionDays: number;
  create: boolean;
  joinLines?: string[];
}): string {
  const host = opts.endpoint.replace(/^https?:\/\//, "");
  const create = opts.create;
  const join = opts.joinLines ?? [];
  const password = create
    ? "# Choose YOUR OWN password — client-side only, NEVER sent to us, and"
    : "# Use the SAME KOPIA_PASSWORD you set when the repo was created —";
  const lastCredFlag = create
    ? `  --secret-access-key=${opts.cred.secretKey} \\`
    : `  --secret-access-key=${opts.cred.secretKey}`;
  const tail = create ? kopiaCreateTail(opts.retentionDays) : [];
  return [
    ...join,
    password,
    "# UNRECOVERABLE if lost:",
    "export KOPIA_PASSWORD='change-me-to-a-strong-passphrase'",
    "",
    `kopia repository ${create ? "create" : "connect"} s3 \\`,
    `  --bucket=${opts.bucket} \\`,
    `  --endpoint=${host} \\`,
    `  --access-key=${opts.cred.accessKeyId} \\`,
    lastCredFlag,
    ...tail,
  ].join("\n");
}

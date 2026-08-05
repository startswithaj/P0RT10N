// Redaction has two layers: declared secret values get masked wherever they occur,
// and argv after `--` is structurally omitted so even an undeclared secret can't leak.

export function maskSecrets(text: string, secrets: string[]): string {
  return secrets.reduce(
    (masked, secret) =>
      secret.length > 0 ? masked.replaceAll(secret, "«redacted»") : masked,
    text,
  );
}

/** Strips values for known secret-carrying env var NAMES out of free text
 * (pod logs, k8s event messages). Unlike `maskSecrets`, this doesn't need the
 * actual secret VALUE in scope — so it still catches a leak from a workload
 * whose secret was minted in a past request the current caller never saw. */
export function maskEnvSecrets(text: string, envNames: string[]): string {
  return envNames.reduce(
    (masked, name) =>
      masked.replace(new RegExp(`\\b${name}=\\S+`, "g"), `${name}=«redacted»`),
    text,
  );
}

/** Everything after a `--` separator becomes a count placeholder in the rendered argv; it is never interpolated. */
export function safeArgs(args: string[]): string {
  const sep = args.indexOf("--");
  if (sep === -1) return args.join(" ");
  const hidden = args.length - sep - 1;
  return [...args.slice(0, sep + 1), `…<${hidden} args>`].join(" ");
}

// Secret redaction for error messages built from shell commands. Two layers:
// callers DECLARE known secret values (masked wherever they occur), and argv
// after `--` is structurally omitted so even an undeclared secret can't leak.
// Shared by McShellClient and docker/TS_AUTHKEY handling.

/** Replace every occurrence of each declared secret in `text`. */
export function maskSecrets(text: string, secrets: string[]): string {
  return secrets.reduce(
    (masked, secret) =>
      secret.length > 0 ? masked.replaceAll(secret, "«redacted»") : masked,
    text,
  );
}

/**
 * Render argv for an error message: everything after a `--` separator is
 * replaced with a count placeholder, never interpolated.
 */
export function safeArgs(args: string[]): string {
  const sep = args.indexOf("--");
  if (sep === -1) return args.join(" ");
  const hidden = args.length - sep - 1;
  return [...args.slice(0, sep + 1), `…<${hidden} args>`].join(" ");
}

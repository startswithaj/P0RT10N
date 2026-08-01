// Redaction has two layers: declared secret values get masked wherever they occur,
// and argv after `--` is structurally omitted so even an undeclared secret can't leak.

export function maskSecrets(text: string, secrets: string[]): string {
  return secrets.reduce(
    (masked, secret) =>
      secret.length > 0 ? masked.replaceAll(secret, "«redacted»") : masked,
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

import { createHmac } from "node:crypto";
import type { S3Credential } from "../minio/mc.ts";
import type { KeyGen } from "./deps.ts";

// Both alphabet sizes (32 and 64) divide 256, so `byte % length` maps without
// bias.

/** MinIO/AWS-style access-key alphabet: uppercase base32 without the ambiguous
 * 0/1/8/9. */
const ACCESS_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"; // 32 chars
const ACCESS_KEY_LENGTH = 20;

const SECRET_ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_"; // 64
const SECRET_KEY_LENGTH = 40;

function randomString(length: number, alphabet: string): string {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
}

/** Two HMAC-SHA256 blocks give 64 deterministic bytes — enough for a 40-char
 * secret. */
function deriveBytes(masterKey: string, info: string): Uint8Array {
  const b0 = createHmac("sha256", masterKey).update(`${info}:0`).digest();
  const b1 = createHmac("sha256", masterKey).update(`${info}:1`).digest();
  return new Uint8Array([...b0, ...b1]);
}

function deriveString(
  masterKey: string,
  info: string,
  length: number,
  alphabet: string,
): string {
  const bytes = deriveBytes(masterKey, info).slice(0, length);
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
}

export class CryptoKeyGen implements KeyGen {
  constructor(private readonly masterKey: string) {}

  generateS3Credential(): S3Credential {
    return {
      accessKeyId: randomString(ACCESS_KEY_LENGTH, ACCESS_ALPHABET),
      secretKey: randomString(SECRET_KEY_LENGTH, SECRET_ALPHABET),
    };
  }

  rootCredentialFor(instanceHost: string): S3Credential {
    return {
      accessKeyId: deriveString(
        this.masterKey,
        `root-user:${instanceHost}`,
        ACCESS_KEY_LENGTH,
        ACCESS_ALPHABET,
      ),
      secretKey: deriveString(
        this.masterKey,
        `root-pass:${instanceHost}`,
        SECRET_KEY_LENGTH,
        SECRET_ALPHABET,
      ),
    };
  }

  /** Derived like root creds: the same master key always yields the same
   * token, so it is never stored or configured. */
  auditWebhookToken(): string {
    return deriveString(
      this.masterKey,
      "audit-webhook-token",
      SECRET_KEY_LENGTH,
      SECRET_ALPHABET,
    );
  }
}

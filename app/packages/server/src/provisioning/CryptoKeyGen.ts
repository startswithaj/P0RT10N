import { createHmac } from "node:crypto";
import type { S3Credential } from "../minio/mc.ts";
import type { KeyGen } from "./deps.ts";

// ============================================================================
// Credential generator. Friend S3 keys are random (CSPRNG); MinIO root creds are
// DERIVED from a master key + instance host (HMAC-SHA256), so the same instance
// always yields the same root credential — stable across container recreations
// and recoverable after a manager wipe, without storing any per-instance secret.
// The master key is the one secret to protect (env → K8s secret / mounted file).
// Both alphabets divide 256 evenly (32, 64), so the byte→char map is unbiased.
// ============================================================================

/** Access key ID: base32-ish, MinIO/AWS-style (uppercase, no ambiguous 0/1/8/9). */
const ACCESS_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"; // 32 chars
const ACCESS_KEY_LENGTH = 20;

/** Secret: 64-char URL-safe alphabet. */
const SECRET_ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_"; // 64
const SECRET_KEY_LENGTH = 40;

function randomString(length: number, alphabet: string): string {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
}

/** 64 deterministic bytes = two HMAC-SHA256 blocks (enough for a 40-char secret). */
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
}

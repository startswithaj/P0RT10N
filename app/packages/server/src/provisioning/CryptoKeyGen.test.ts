import { describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { CryptoKeyGen } from "./CryptoKeyGen.ts";

describe("CryptoKeyGen", () => {
  it("generates a random S3 credential of the expected shape", () => {
    const { accessKeyId, secretKey } = new CryptoKeyGen("master")
      .generateS3Credential();

    expect(accessKeyId).toMatch(/^[A-Z2-7]{20}$/);
    expect(secretKey).toMatch(/^[A-Za-z0-9_-]{40}$/);
  });

  it("produces distinct S3 credentials across calls", () => {
    const gen = new CryptoKeyGen("master");
    const a = gen.generateS3Credential();
    const b = gen.generateS3Credential();

    expect(a.accessKeyId).not.toBe(b.accessKeyId);
    expect(a.secretKey).not.toBe(b.secretKey);
  });

  it("derives a root credential of the expected shape", () => {
    const { accessKeyId, secretKey } = new CryptoKeyGen("master")
      .rootCredentialFor("alice");

    expect(accessKeyId).toMatch(/^[A-Z2-7]{20}$/);
    expect(secretKey).toMatch(/^[A-Za-z0-9_-]{40}$/);
  });

  it("derives root creds deterministically — stable per host + master key", () => {
    const gen = new CryptoKeyGen("master-1");

    // Same host and master key produce identical creds, so they survive container or manager recreation.
    expect(gen.rootCredentialFor("alice")).toEqual(
      gen.rootCredentialFor("alice"),
    );
    // A different host produces different creds.
    expect(gen.rootCredentialFor("alice")).not.toEqual(
      gen.rootCredentialFor("bob"),
    );
    // A different master key produces different creds for the same host.
    expect(new CryptoKeyGen("master-2").rootCredentialFor("alice")).not.toEqual(
      gen.rootCredentialFor("alice"),
    );
  });

  it("derives the audit token deterministically, distinct from root creds", () => {
    const gen = new CryptoKeyGen("master-1");
    const token = gen.auditWebhookToken();

    expect(token).toMatch(/^[A-Za-z0-9_-]{40}$/);
    // Same master key derives the same token every time since nothing is
    // stored; the listener and instances independently agree.
    expect(new CryptoKeyGen("master-1").auditWebhookToken()).toBe(token);
    // A different master key derives a different token.
    expect(new CryptoKeyGen("master-2").auditWebhookToken()).not.toBe(token);
    // Distinct derivation domain, so it never collides with any root credential.
    expect(gen.rootCredentialFor("alice").secretKey).not.toBe(token);
  });
});

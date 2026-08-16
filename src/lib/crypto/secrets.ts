import "server-only";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/*
 * Envelope encryption for user-supplied secrets — today, model provider API
 * keys.
 *
 * AES-256-GCM, which is authenticated: a row that has been tampered with, or
 * moved to a different user, fails to decrypt rather than quietly producing
 * the wrong plaintext.
 */

export type SealedSecret = {
  /** base64 */
  ciphertext: string;
  /** base64, 12 bytes — GCM's canonical nonce size */
  iv: string;
  /** base64, 16 bytes */
  authTag: string;
  /** Which key sealed it. Rotation depends on this being per-record. */
  keyVersion: string;
};

const CURRENT_VERSION = process.env.ENCRYPTION_KEY_VERSION || "v1";

/**
 * Keys come from the environment, one per version:
 *
 *   ENCRYPTION_KEY       → v1
 *   ENCRYPTION_KEY_V2    → v2
 *
 * Each is 32 raw bytes, base64-encoded: `openssl rand -base64 32`.
 *
 * Rotation is a deploy, not a migration: set the new key, bump
 * ENCRYPTION_KEY_VERSION, and existing rows keep decrypting under the old
 * one until something re-seals them.
 *
 * Resolved on use, not at import — same reasoning as the lazy Composio
 * client: a missing key should fail only the request that needs it, not
 * every page that imports this module.
 */
function keyForVersion(version: string): Buffer {
  const envVar =
    version === "v1"
      ? "ENCRYPTION_KEY"
      : `ENCRYPTION_KEY_${version.toUpperCase()}`;
  const raw = process.env[envVar];

  if (!raw) {
    throw new Error(
      `${envVar} is not set — cannot read or write ${version} secrets. ` +
        `Generate one with: openssl rand -base64 32`,
    );
  }

  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) {
    throw new Error(
      `${envVar} must be 32 bytes base64-encoded (got ${key.length}).`,
    );
  }
  return key;
}

/**
 * `aad` binds the ciphertext to the row it belongs to — pass
 * `${userId}:${provider}`.
 *
 * Without it, a row copied from one user to another would decrypt fine and
 * hand over the first user's key. With it, the copy fails authentication.
 */
export function encryptSecret(plaintext: string, aad: string): SealedSecret {
  const iv = randomBytes(12);
  const cipher = createCipheriv(
    "aes-256-gcm",
    keyForVersion(CURRENT_VERSION),
    iv,
  );
  cipher.setAAD(Buffer.from(`${CURRENT_VERSION}:${aad}`, "utf8"));

  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);

  return {
    ciphertext: ciphertext.toString("base64"),
    iv: iv.toString("base64"),
    authTag: cipher.getAuthTag().toString("base64"),
    keyVersion: CURRENT_VERSION,
  };
}

export function decryptSecret(sealed: SealedSecret, aad: string): string {
  const decipher = createDecipheriv(
    "aes-256-gcm",
    keyForVersion(sealed.keyVersion),
    Buffer.from(sealed.iv, "base64"),
  );
  decipher.setAAD(Buffer.from(`${sealed.keyVersion}:${aad}`, "utf8"));
  decipher.setAuthTag(Buffer.from(sealed.authTag, "base64"));

  // `final()` throws on tag mismatch — a tampered, misfiled, or wrong-key row
  // never yields plaintext.
  return Buffer.concat([
    decipher.update(Buffer.from(sealed.ciphertext, "base64")),
    decipher.final(),
  ]).toString("utf8");
}

/** The only part of a secret that may ever reach a browser. */
export function last4(secret: string): string {
  return secret.slice(-4);
}

/*
 * Anything key-shaped, scrubbed.
 *
 * Provider SDK errors carry the request they failed on, and this app shows
 * error messages to users and writes them to `runs.error`. Either path
 * echoing a key back is a leak that only shows up in production logs, so
 * every user-facing error string goes through here.
 */
const SECRET_PATTERNS: Array<[RegExp, string]> = [
  [/sk-ant-[A-Za-z0-9_-]{8,}/g, "sk-ant-***"],
  [/sk-proj-[A-Za-z0-9_-]{8,}/g, "sk-proj-***"],
  [/sk-[A-Za-z0-9_-]{16,}/g, "sk-***"],
  [/\bvck_[A-Za-z0-9_-]{8,}/g, "vck_***"],
  [/\bBearer\s+[A-Za-z0-9._-]{16,}/gi, "Bearer ***"],
];

export function redactSecrets(text: string): string {
  return SECRET_PATTERNS.reduce(
    (out, [pattern, replacement]) => out.replace(pattern, replacement),
    text,
  );
}

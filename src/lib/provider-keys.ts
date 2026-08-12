import "server-only";
import { and, eq } from "drizzle-orm";
import { createGateway } from "@ai-sdk/gateway";
import { db } from "@/db";
import { userProviderKeys } from "@/db/schema";
import {
  decryptSecret,
  encryptSecret,
  last4,
  redactSecrets,
} from "@/lib/crypto/secrets";
import { PROVIDER_IDS, providerMeta, type ProviderId } from "@/lib/providers";
import { LOCAL_AUTH_BYPASS } from "@/lib/auth/local";

/*
 * Bring-your-own-key storage.
 *
 * Every run this app performs is paid for by the person who scheduled it, so
 * the key is theirs and lives here encrypted. Three rules hold this together:
 *
 *  1. Plaintext is produced in exactly one function (`loadProviderKey`), and
 *     only server-side callers that need to sign a request use it.
 *  2. Nothing else ever leaves this module — `listKeyMeta` is deliberately
 *     the only shape a component can render.
 *  3. A key is verified against the provider before it is stored, so "saved"
 *     never means "saved and broken".
 */

export type StoredKeyMeta = {
  provider: ProviderId;
  last4: string;
  verifiedAt: Date | null;
  lastUsedAt: Date | null;
  createdAt: Date;
};

/** The AAD binding a row to its owner — see `encryptSecret`. */
function aadFor(userId: string, provider: ProviderId): string {
  return `${userId}:${provider}`;
}

/**
 * The Docker stack resets its database on `docker compose down -v`, so there
 * is nowhere durable to paste a key. Falling back to the environment keeps
 * local development working — behind the same two locks that gate the auth
 * bypass, so a production build can never reach this. One place, so every
 * caller that needs "is there a key" agrees with the one that decrypts it.
 */
function bypassKey(provider: ProviderId): string | null {
  if (!LOCAL_AUTH_BYPASS) return null;
  return process.env[providerMeta(provider).envVar] ?? null;
}

/**
 * What the settings UI renders. Note the explicit column list: a
 * `select().from(userProviderKeys)` here would put ciphertext, IV and auth tag
 * into the RSC flight payload, which is fully readable in the browser.
 */
export async function listKeyMeta(userId: string): Promise<StoredKeyMeta[]> {
  const rows = await db
    .select({
      provider: userProviderKeys.provider,
      last4: userProviderKeys.last4,
      verifiedAt: userProviderKeys.verifiedAt,
      lastUsedAt: userProviderKeys.lastUsedAt,
      createdAt: userProviderKeys.createdAt,
    })
    .from(userProviderKeys)
    .where(eq(userProviderKeys.userId, userId));

  return rows.map((row) => ({ ...row, provider: row.provider as ProviderId }));
}

export async function hasProviderKey(
  userId: string,
  provider: ProviderId,
): Promise<boolean> {
  const [row] = await db
    .select({ id: userProviderKeys.id })
    .from(userProviderKeys)
    .where(
      and(
        eq(userProviderKeys.userId, userId),
        eq(userProviderKeys.provider, provider),
      ),
    )
    .limit(1);
  if (row) return true;

  /*
   * Same environment fallback `loadProviderKey` applies, and for the same
   * reason — but it has to be here too, or it is unreachable from the path
   * that matters. The dispatcher asks this question before enqueuing, so
   * without it every cron tick on the Docker stack answers `no_provider_key`
   * and no local workflow ever runs, however the environment is configured.
   */
  return bypassKey(provider) !== null;
}

/**
 * True if the user can run anything at all. Drives the onboarding checklist.
 *
 * Checks the bypass fallback too — otherwise a local Docker setup running
 * entirely on an env-var key (no row ever saved) would fail this while every
 * per-provider `hasProviderKey` check above it passes, and the checklist
 * would tell a working setup it still needs a key.
 */
export async function hasAnyProviderKey(userId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: userProviderKeys.id })
    .from(userProviderKeys)
    .where(eq(userProviderKeys.userId, userId))
    .limit(1);
  if (row) return true;

  return LOCAL_AUTH_BYPASS
    ? PROVIDER_IDS.some((provider) => bypassKey(provider) !== null)
    : false;
}

/**
 * The plaintext key, or null.
 *
 * The single place a stored secret is decrypted. Not exported from any barrel
 * file, and every caller is server-side by construction (`server-only` above).
 */
export async function loadProviderKey(
  userId: string,
  provider: ProviderId,
): Promise<string | null> {
  const [row] = await db
    .select()
    .from(userProviderKeys)
    .where(
      and(
        eq(userProviderKeys.userId, userId),
        eq(userProviderKeys.provider, provider),
      ),
    )
    .limit(1);

  if (!row) return bypassKey(provider);

  try {
    return decryptSecret(
      {
        ciphertext: row.ciphertext,
        iv: row.iv,
        authTag: row.authTag,
        keyVersion: row.keyVersion,
      },
      aadFor(userId, provider),
    );
  } catch (err) {
    // A row that won't decrypt is unusable — most likely ENCRYPTION_KEY
    // changed without the old version still being available. Say so loudly in
    // the log; the caller sees it as "no key", which is the honest result.
    console.error("[provider-keys] decrypt failed", { userId, provider, err });
    return null;
  }
}

/** Records that a key was used, for the "last used" line in settings. */
export async function touchProviderKey(userId: string, provider: ProviderId) {
  await db
    .update(userProviderKeys)
    .set({ lastUsedAt: new Date() })
    .where(
      and(
        eq(userProviderKeys.userId, userId),
        eq(userProviderKeys.provider, provider),
      ),
    );
}

export class InvalidProviderKeyError extends Error {
  constructor(message: string) {
    super(redactSecrets(message));
    this.name = "InvalidProviderKeyError";
  }
}

/**
 * Verifies a key against the provider with one cheap call.
 *
 * Worth the round trip: a mistyped key otherwise saves fine and only surfaces
 * as a failed run hours later, on a schedule, with the failure recorded
 * against the workflow rather than the key.
 */
async function verifyKey(provider: ProviderId, apiKey: string): Promise<void> {
  const meta = providerMeta(provider);
  const signal = AbortSignal.timeout(10_000);

  try {
    if (provider === "gateway") {
      await createGateway({ apiKey }).getAvailableModels();
      return;
    }

    const res =
      provider === "anthropic"
        ? await fetch("https://api.anthropic.com/v1/models?limit=1", {
            headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
            signal,
          })
        : await fetch("https://api.openai.com/v1/models", {
            headers: { Authorization: `Bearer ${apiKey}` },
            signal,
          });

    if (!res.ok) {
      // The status, never the body: provider error bodies echo the request,
      // and this string is rendered back to the user.
      throw new InvalidProviderKeyError(
        `${meta.label} rejected that key (HTTP ${res.status}).`,
      );
    }
  } catch (err) {
    if (err instanceof InvalidProviderKeyError) throw err;
    if (err instanceof Error && err.name === "TimeoutError") {
      throw new InvalidProviderKeyError(
        `${meta.label} didn't respond in time. Try again in a moment.`,
      );
    }
    throw new InvalidProviderKeyError(
      `Couldn't reach ${meta.label} to check that key.`,
    );
  }
}

/**
 * Verifies, encrypts, and stores. Replaces any existing key for the provider.
 */
export async function saveProviderKey(
  userId: string,
  provider: ProviderId,
  apiKey: string,
): Promise<void> {
  const key = apiKey.trim();
  const meta = providerMeta(provider);

  // Shape first, so an obvious typo doesn't cost a network round trip — and
  // doesn't burn a rate-limit token against the provider.
  if (key.length < 16 || key.length > 512) {
    throw new InvalidProviderKeyError("That doesn't look like an API key.");
  }
  if (meta.keyPrefix && !key.startsWith(meta.keyPrefix)) {
    throw new InvalidProviderKeyError(
      `${meta.label} keys start with "${meta.keyPrefix}".`,
    );
  }

  await verifyKey(provider, key);

  const sealed = encryptSecret(key, aadFor(userId, provider));
  const now = new Date();

  await db
    .insert(userProviderKeys)
    .values({
      userId,
      provider,
      ciphertext: sealed.ciphertext,
      iv: sealed.iv,
      authTag: sealed.authTag,
      keyVersion: sealed.keyVersion,
      last4: last4(key),
      verifiedAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [userProviderKeys.userId, userProviderKeys.provider],
      set: {
        ciphertext: sealed.ciphertext,
        iv: sealed.iv,
        authTag: sealed.authTag,
        keyVersion: sealed.keyVersion,
        last4: last4(key),
        verifiedAt: now,
        lastUsedAt: null,
        updatedAt: now,
      },
    });
}

export async function deleteProviderKey(
  userId: string,
  provider: ProviderId,
): Promise<void> {
  await db
    .delete(userProviderKeys)
    .where(
      and(
        eq(userProviderKeys.userId, userId),
        eq(userProviderKeys.provider, provider),
      ),
    );
}

import { eq } from "drizzle-orm";
import type { LanguageModel } from "ai";
import { createGateway } from "@ai-sdk/gateway";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import { db } from "@/db";
import { userSettings } from "@/db/schema";
import { loadProviderKey } from "@/lib/provider-keys";
import {
  DEFAULT_PROVIDER,
  isProviderId,
  providerMeta,
  providerRoutes,
  splitModelId,
  type ProviderId,
} from "@/lib/providers";

/*
 * Model routing, per user.
 *
 * Two things are per user here and both matter: *which* provider serves
 * their models, and *whose key* pays for it. Every entry point takes a
 * `users.id` because half the callers have no session — a cron tick and a
 * trigger webhook read the owner off the workflow row, the only statement
 * of ownership those code paths have.
 */

const PROVIDER_TTL_MS = 10_000;
const providerCache = new Map<string, { at: number; provider: ProviderId }>();

export function clearProviderCache() {
  providerCache.clear();
  clientCache.clear();
}

/** The provider serving models for one account. */
export async function getProviderForUser(userId: string): Promise<ProviderId> {
  const hit = providerCache.get(userId);
  if (hit && Date.now() - hit.at < PROVIDER_TTL_MS) return hit.provider;

  let provider: ProviderId = DEFAULT_PROVIDER;
  try {
    const [row] = await db
      .select({ value: userSettings.modelProvider })
      .from(userSettings)
      .where(eq(userSettings.userId, userId))
      .limit(1);
    if (isProviderId(row?.value)) provider = row.value;
  } catch {
    // No settings row yet: the gateway default is exactly the behaviour this
    // app had before the toggle existed.
  }

  providerCache.set(userId, { at: Date.now(), provider });
  return provider;
}

export async function setProviderForUser(
  userId: string,
  email: string,
  provider: ProviderId,
): Promise<void> {
  await db
    .insert(userSettings)
    .values({
      email: email.toLowerCase(),
      userId,
      modelProvider: provider,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: userSettings.email,
      set: { userId, modelProvider: provider, updatedAt: new Date() },
    });
  clearProviderCache();
}

/**
 * Thrown when the account has no key for the provider it's set to use.
 *
 * This app is bring-your-own-key: there's no app-wide fallback, so this is
 * a normal state for a new account rather than a misconfiguration — which
 * is why the message says what to do, not what went wrong.
 */
export class MissingProviderKeyError extends Error {
  constructor(readonly provider: ProviderId) {
    super(
      `No ${providerMeta(provider).label} API key on this account. ` +
        `Add one under Account → Model provider before running workflows.`,
    );
    this.name = "MissingProviderKeyError";
  }
}

/**
 * Thrown when a workflow's stored model can't be served by its owner's
 * provider — switching to Anthropic doesn't rewrite a workflow pinned to
 * `openai/gpt-5`. Silently substituting a model would change what the run
 * costs and how it reasons, so this surfaces instead.
 */
export class ModelUnavailableError extends Error {
  constructor(
    readonly modelId: string,
    readonly provider: ProviderId,
  ) {
    super(
      `Model "${modelId}" is not available through ${providerMeta(provider).label}. ` +
        `Pick a different model for this workflow, or switch providers in Settings.`,
    );
    this.name = "ModelUnavailableError";
  }
}

/*
 * Per-user provider clients, cached briefly.
 *
 * Be clear-eyed about what this caches: the client holds the API key
 * internally, so plaintext key material is resident in process memory
 * either way — it has to be, to sign the HTTPS request. Caching the client
 * rather than decrypting per call changes nothing about that; it just saves
 * a database round trip.
 *
 * What actually matters is the invariants around it:
 *   - keyed by `${userId}:${provider}`, never enumerated, never exported;
 *   - a hard TTL, so a revoked/replaced key stops working within a minute
 *     rather than whenever the instance recycles;
 *   - a size cap, so a busy instance can't accumulate every tenant's key;
 *   - never serialized — not to a log, a response, or an RSC payload.
 */
const CLIENT_TTL_MS = 60_000;
const MAX_CLIENTS = 500;

type ProviderClient =
  | ReturnType<typeof createGateway>
  | ReturnType<typeof createAnthropic>
  | ReturnType<typeof createOpenAI>;

const clientCache = new Map<string, { at: number; client: ProviderClient }>();

function evictExpiredClients() {
  const now = Date.now();
  for (const [key, entry] of clientCache) {
    if (now - entry.at > CLIENT_TTL_MS) clientCache.delete(key);
  }
  while (clientCache.size > MAX_CLIENTS) {
    const oldest = clientCache.keys().next().value;
    if (oldest === undefined) break;
    clientCache.delete(oldest);
  }
}

/** Drops one user's cached clients — call after their key or provider changes. */
export function clearProviderKeyCache(userId?: string) {
  if (!userId) {
    clientCache.clear();
    providerCache.clear();
    return;
  }
  providerCache.delete(userId);
  for (const key of clientCache.keys()) {
    if (key.startsWith(`${userId}:`)) clientCache.delete(key);
  }
}

async function clientFor(
  userId: string,
  provider: ProviderId,
): Promise<ProviderClient> {
  const cacheKey = `${userId}:${provider}`;
  const hit = clientCache.get(cacheKey);
  if (hit && Date.now() - hit.at < CLIENT_TTL_MS) return hit.client;

  const apiKey = await loadProviderKey(userId, provider);
  if (!apiKey) throw new MissingProviderKeyError(provider);

  const client: ProviderClient =
    provider === "anthropic"
      ? createAnthropic({ apiKey })
      : provider === "openai"
        ? createOpenAI({ apiKey })
        : createGateway({ apiKey });

  evictExpiredClients();
  clientCache.set(cacheKey, { at: Date.now(), client });
  return client;
}

/**
 * Turns a stored model id into something `generateText` can run, through
 * whichever provider the account has switched on and that account's own
 * key. The gateway takes the full slug; direct providers take the bare
 * model name.
 */
export async function resolveModelForUser(
  userId: string,
  modelId: string,
): Promise<LanguageModel> {
  const provider = await getProviderForUser(userId);
  if (!providerRoutes(provider, modelId)) {
    throw new ModelUnavailableError(modelId, provider);
  }

  const client = await clientFor(userId, provider);
  const { slug } = splitModelId(modelId);

  switch (provider) {
    case "anthropic":
      return (client as ReturnType<typeof createAnthropic>)(slug);
    case "openai":
      return (client as ReturnType<typeof createOpenAI>)(slug);
    default:
      return (client as ReturnType<typeof createGateway>)(modelId);
  }
}

import { eq } from "drizzle-orm";
import type { LanguageModel } from "ai";
import { gateway } from "@ai-sdk/gateway";
import { anthropic } from "@ai-sdk/anthropic";
import { openai } from "@ai-sdk/openai";
import { db } from "@/db";
import { userSettings } from "@/db/schema";
import {
  DEFAULT_PROVIDER,
  isProviderId,
  providerMeta,
  providerRoutes,
  splitModelId,
  type ProviderId,
} from "@/lib/providers";

/*
 * The provider is a per-account setting, so everything here takes the account
 * it applies to. Two kinds of caller:
 *
 * - Pages, actions and route handlers have a session: they pass nothing and
 *   get the signed-in user's provider (see `currentUserEmail`).
 * - Scheduled runs and webhook-triggered runs have no session at all. They
 *   pass `workflows.ownerEmail` explicitly — without it every cron tick would
 *   quietly run on the default provider instead of the owner's choice.
 *
 * A null/unknown account resolves to the app default rather than throwing: a
 * pre-existing workflow row has no owner recorded, and refusing to run it
 * would be a worse answer than running it the way it ran yesterday.
 */

const TTL_MS = 10_000;
const cache = new Map<string, { at: number; provider: ProviderId }>();

export function clearProviderCache() {
  cache.clear();
}

/** The provider serving models for one account. */
export async function getProviderFor(
  email: string | null | undefined,
): Promise<ProviderId> {
  /*
   * Workflows created before `owner_email` existed have no owner recorded.
   * Access is gated to a single OWNER_EMAIL, so that account is who they
   * belong to — reading its setting beats defaulting them to the gateway and
   * quietly ignoring the choice the owner made in Settings.
   */
  const account = email || process.env.OWNER_EMAIL;
  if (!account) return DEFAULT_PROVIDER;

  const key = account.toLowerCase();
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.provider;

  let provider: ProviderId = DEFAULT_PROVIDER;
  try {
    const [row] = await db
      .select({ value: userSettings.modelProvider })
      .from(userSettings)
      .where(eq(userSettings.email, key))
      .limit(1);
    if (isProviderId(row?.value)) provider = row.value;
  } catch {
    // No settings row yet, or the migration hasn't run: the gateway default
    // is exactly the behaviour this app had before the toggle existed.
  }

  cache.set(key, { at: Date.now(), provider });
  return provider;
}

export async function setProviderFor(
  email: string,
  provider: ProviderId,
): Promise<void> {
  const key = email.toLowerCase();
  await db
    .insert(userSettings)
    .values({ email: key, modelProvider: provider, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: userSettings.email,
      set: { modelProvider: provider, updatedAt: new Date() },
    });
  clearProviderCache();
}

/** True if the key this provider needs is present in the environment. */
export function providerConfigured(provider: ProviderId): boolean {
  return Boolean(process.env[providerMeta(provider).envVar]);
}

/**
 * Thrown when a workflow's stored model can't be served by its owner's
 * provider — switching to Anthropic doesn't rewrite a workflow pinned to
 * `openai/gpt-5`. Substituting a different model silently would change what
 * the run costs and how it reasons, so this surfaces instead.
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

/**
 * Turns a stored model id into something `generateText` can run, through
 * whichever provider the given account has switched on. The gateway takes the
 * full slug; direct providers take the bare model name.
 */
export async function resolveModelFor(
  email: string | null | undefined,
  modelId: string,
): Promise<LanguageModel> {
  const provider = await getProviderFor(email);
  if (!providerRoutes(provider, modelId)) {
    throw new ModelUnavailableError(modelId, provider);
  }

  const { slug } = splitModelId(modelId);
  switch (provider) {
    case "anthropic":
      return anthropic(slug);
    case "openai":
      return openai(slug);
    default:
      return gateway(modelId);
  }
}

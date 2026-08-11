"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth/user";
import { clearProviderKeyCache, setProviderForUser } from "@/lib/provider";
import {
  deleteProviderKey,
  hasProviderKey,
  saveProviderKey,
} from "@/lib/provider-keys";
import { redactSecrets } from "@/lib/crypto/secrets";
import { clearModelCatalogCache } from "@/lib/models";
import { isProviderId, providerMeta } from "@/lib/providers";
import { takeToken } from "@/lib/rate-limit";

const SETTINGS_PATH = "/account/model-provider";

function backWith(kind: "error" | "notice", message: string): never {
  // Redacted on the way out: provider SDK errors quote the request they failed
  // on, and this string is rendered straight into the page.
  redirect(
    `${SETTINGS_PATH}?${kind}=${encodeURIComponent(redactSecrets(message))}`,
  );
}

/**
 * Switches which SDK provider serves models for the signed-in account.
 *
 * Refuses a provider the account has no key for — the switch would leave every
 * workflow unable to run, and the failure would surface later as a broken
 * scheduled run instead of here, where the user can act on it.
 */
export async function switchProvider(formData: FormData) {
  const user = await requireUser();

  const provider = formData.get("provider");
  if (!isProviderId(provider)) backWith("error", "Unknown provider.");

  if (!(await hasProviderKey(user.id, provider))) {
    backWith(
      "error",
      `Add a ${providerMeta(provider).label} API key before switching to it.`,
    );
  }

  await setProviderForUser(user.id, user.email, provider);
  // The catalog is memoized per provider for an hour; without this the picker
  // would keep offering the old provider's models until it expired.
  clearModelCatalogCache();

  revalidatePath(SETTINGS_PATH);
  revalidatePath("/workflows");
  backWith("notice", `Models now served by ${providerMeta(provider).label}.`);
}

/**
 * Stores an API key for the signed-in account.
 *
 * The key is verified against the provider before it is saved, so "added"
 * always means "works". That costs one live call, which is also why it's rate
 * limited — this form would otherwise be a free oracle for testing stolen keys
 * against Anthropic and OpenAI.
 */
export async function addProviderKey(formData: FormData) {
  const user = await requireUser();

  const provider = formData.get("provider");
  if (!isProviderId(provider)) backWith("error", "Unknown provider.");

  const apiKey = String(formData.get("apiKey") ?? "");
  if (!apiKey.trim()) backWith("error", "Paste an API key first.");

  const gate = await takeToken(user.id, "key_verify");
  if (!gate.ok) {
    backWith(
      "error",
      `Too many key checks. Try again in ${Math.ceil(gate.retryAfterMs / 60_000)} minutes.`,
    );
  }

  try {
    await saveProviderKey(user.id, provider, apiKey);
  } catch (err) {
    backWith("error", err instanceof Error ? err.message : String(err));
  }

  // The cached client for this user holds the *old* key.
  clearProviderKeyCache(user.id);
  clearModelCatalogCache();

  revalidatePath(SETTINGS_PATH);
  revalidatePath("/workflows");
  revalidatePath("/");
  backWith("notice", `${providerMeta(provider).label} key saved and verified.`);
}

export async function removeProviderKey(formData: FormData) {
  const user = await requireUser();

  const provider = formData.get("provider");
  if (!isProviderId(provider)) backWith("error", "Unknown provider.");

  await deleteProviderKey(user.id, provider);
  clearProviderKeyCache(user.id);
  clearModelCatalogCache();

  revalidatePath(SETTINGS_PATH);
  revalidatePath("/workflows");
  backWith(
    "notice",
    `${providerMeta(provider).label} key removed. Workflows using it won't run until you add one.`,
  );
}

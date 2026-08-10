"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { currentUserEmail, requireOwner } from "@/lib/auth/require-owner";
import { providerConfigured, setProviderFor } from "@/lib/provider";
import { clearModelCatalogCache } from "@/lib/models";
import { isProviderId, providerMeta } from "@/lib/providers";

/**
 * Switches which SDK provider serves models for the signed-in account. Refuses a provider whose key
 * isn't set — the switch would leave every workflow unable to run, and the
 * failure would surface later as a broken run instead of here.
 */
export async function switchProvider(formData: FormData) {
  await requireOwner();

  const email = await currentUserEmail();
  if (!email) redirect("/auth/sign-in");

  const provider = formData.get("provider");
  if (!isProviderId(provider)) {
    redirect(
      `/account/model-provider?error=${encodeURIComponent("Unknown provider.")}`,
    );
  }

  if (!providerConfigured(provider)) {
    const { label, envVar } = providerMeta(provider);
    redirect(
      `/account/model-provider?error=${encodeURIComponent(
        `${label} has no API key. Set ${envVar} and restart the app.`,
      )}`,
    );
  }

  await setProviderFor(email, provider);
  // The catalog is memoized per provider for an hour; without this the picker
  // would keep offering the old provider's models until it expired.
  clearModelCatalogCache();

  revalidatePath("/account/model-provider");
  revalidatePath("/workflows");
  redirect(
    `/account/model-provider?notice=${encodeURIComponent(
      `Models now served by ${providerMeta(provider).label}.`,
    )}`,
  );
}

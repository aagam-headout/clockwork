"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth/user";
import { setWorkflowDefaultsForUser } from "@/lib/workflow-defaults";
import { MAX_COST_CAP_USD } from "@/lib/cost-cap";
import { TIMEZONES } from "@/lib/timezones";

const SETTINGS_PATH = "/account/workflow-defaults";

function backWith(kind: "error" | "notice", message: string): never {
  redirect(`${SETTINGS_PATH}?${kind}=${encodeURIComponent(message)}`);
}

/**
 * The monthly budget field. Blank means "no stored default" — the new
 * workflow form falls back to its own built-in uncapped default. Mirrors
 * `parseCostCap` in `@/lib/actions`: zero is rejected rather than quietly
 * treated as uncapped.
 */
function parseDefaultCostCap(raw: string): string | null {
  if (!raw) return null;
  const value = Number(raw);
  // Checked after rounding, not before: the column holds two decimals, so
  // 0.004 would store as "0.00" — which `judgeCap` reads as uncapped, the
  // exact opposite of what someone typing a tiny number asked for.
  const stored = Number(value.toFixed(2));
  if (!Number.isFinite(value) || stored <= 0) {
    throw new Error(
      "Use a monthly budget of at least $0.01, or leave it blank for no default.",
    );
  }
  if (value > MAX_COST_CAP_USD) {
    throw new Error(
      `Keep the monthly budget under $${MAX_COST_CAP_USD.toLocaleString()}.`,
    );
  }
  return stored.toFixed(2);
}

/** Saves the account-level defaults prefilled onto every new workflow. */
export async function setWorkflowDefaults(formData: FormData) {
  const user = await requireUser();

  const rawTimezone = String(formData.get("timezone") ?? "").trim();
  if (rawTimezone && !TIMEZONES.includes(rawTimezone)) {
    backWith("error", "Unknown timezone.");
  }

  let monthlyCostCapUsd: string | null;
  try {
    monthlyCostCapUsd = parseDefaultCostCap(
      String(formData.get("monthlyCostCapUsd") ?? "").trim(),
    );
  } catch (err) {
    backWith("error", err instanceof Error ? err.message : String(err));
  }

  await setWorkflowDefaultsForUser(user.id, user.email, {
    timezone: rawTimezone || null,
    monthlyCostCapUsd,
  });

  revalidatePath(SETTINGS_PATH);
  backWith("notice", "Defaults saved. They apply to new workflows only.");
}

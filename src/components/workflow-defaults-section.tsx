import { getWorkflowDefaultsForUser } from "@/lib/workflow-defaults";
import { setWorkflowDefaults } from "@/app/settings/workflow-defaults-actions";
import { SubmitButton } from "@/components/submit-button";
import { SectionIntro, SettingsCard } from "@/components/ui";
import { DEFAULT_TIMEZONE, TIMEZONES } from "@/lib/timezones";
import type { AppUser } from "@/lib/auth/user";

/**
 * Account-level defaults prefilled onto every new workflow's form. Existing
 * workflows are untouched — this only changes what a blank "New workflow"
 * starts with, same as the built-in Asia/Kolkata + uncapped defaults it
 * replaces when set.
 */
export async function WorkflowDefaultsSection({ user }: { user: AppUser }) {
  const defaults = await getWorkflowDefaultsForUser(user.id);

  return (
    <div className="grid gap-4 md:gap-6">
      <SectionIntro
        title="Workflow defaults"
        description="Prefilled on new workflows. Every workflow can still override them."
      />

      <form action={setWorkflowDefaults}>
        <SettingsCard
          footer={
            <SubmitButton variant="primary" pendingLabel="Saving…">
              Save
            </SubmitButton>
          }
        >
          <div className="grid gap-4 sm:max-w-sm">
            <label className="grid gap-1.5">
              <span className="text-foreground text-[13px] font-medium">
                Timezone
              </span>
              <select
                name="timezone"
                defaultValue={defaults.timezone ?? ""}
                className="input"
              >
                <option value="">No default ({DEFAULT_TIMEZONE})</option>
                {TIMEZONES.map((tz) => (
                  <option key={tz} value={tz}>
                    {tz}
                  </option>
                ))}
              </select>
            </label>

            <label className="grid gap-1.5">
              <span className="text-foreground text-[13px] font-medium">
                Monthly budget (USD)
              </span>
              <input
                name="monthlyCostCapUsd"
                type="number"
                min="0.01"
                step="0.01"
                inputMode="decimal"
                defaultValue={defaults.monthlyCostCapUsd ?? ""}
                placeholder="No default (uncapped)"
                className="input font-mono tabular-nums"
              />
              <span className="text-subtle text-[12px]">
                Leave blank to start new workflows uncapped.
              </span>
            </label>
          </div>
        </SettingsCard>
      </form>
    </div>
  );
}

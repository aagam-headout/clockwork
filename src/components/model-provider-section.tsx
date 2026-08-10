import Link from "next/link";
import { desc } from "drizzle-orm";
import { Check, KeyRound, TriangleAlert } from "lucide-react";
import { db } from "@/db";
import { workflows } from "@/db/schema";
import { getProviderFor, providerConfigured } from "@/lib/provider";
import { getModelCatalog } from "@/lib/models";
import { PROVIDERS, providerRoutes } from "@/lib/providers";
import { switchProvider } from "@/app/settings/actions";
import { SubmitButton } from "@/components/submit-button";
import { Alert, ListBox, Mono } from "@/components/ui";

/**
 * Which SDK provider serves every model call this account makes — workflow
 * runs and the builder assistant alike. Lives under Account since it's a
 * per-account credential choice, not a workflow setting.
 */
export async function ModelProviderSection({ email }: { email: string }) {
  const [active, catalog, rows] = await Promise.all([
    getProviderFor(email),
    getModelCatalog(),
    db
      .select({
        id: workflows.id,
        name: workflows.name,
        model: workflows.model,
        ownerEmail: workflows.ownerEmail,
      })
      .from(workflows)
      .orderBy(desc(workflows.createdAt)),
  ]);

  // Switching providers doesn't rewrite stored model ids, so a workflow can be
  // left pinned to a model the active provider can't route. Those runs fail
  // loudly at execution time — say so here instead, while it's still fixable.
  // Only this account's workflows — a run uses its own owner's provider, so
  // someone else's rows aren't affected by what is selected here. Rows created
  // before the column existed have no owner and fall back to this account.
  const stranded = rows.filter(
    (w) =>
      (w.ownerEmail == null || w.ownerEmail === email) &&
      !providerRoutes(active, w.model),
  );

  return (
    <div className="grid gap-4 md:gap-6">
      <div>
        <h2 className="heading-16 text-foreground">Model provider</h2>
        <p className="text-muted mt-1.5 text-sm leading-relaxed">
          Routes every model call on your account — workflow runs and the
          builder assistant alike. Keys come from the environment; a provider
          without one can&apos;t be selected.
        </p>

        <ListBox as="ul" className="mt-4">
          {PROVIDERS.map((p) => {
            const isActive = p.id === active;
            const configured = providerConfigured(p.id);
            return (
              <li
                key={p.id}
                className="flex flex-wrap items-center gap-3 px-4 py-3.5"
              >
                <span
                  className={`rounded-control flex h-9 w-9 shrink-0 items-center justify-center border ${
                    isActive
                      ? "border-accent/25 bg-accent-soft text-accent-text"
                      : configured
                        ? "border-border bg-surface-2 text-subtle"
                        : "border-warn-line bg-warn-soft text-warn-text"
                  }`}
                >
                  <KeyRound className="h-4 w-4" />
                </span>

                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-foreground text-sm font-medium">
                      {p.label}
                    </span>
                  </div>
                  <p className="text-subtle mt-1 flex items-center gap-1.5 text-[12px]">
                    {/* `!` forces it: `text-[11px]` is baked into Mono's own
                        class list, and Tailwind's utility order (not source
                        order) decides the tie otherwise. */}
                    <Mono className="text-[9px]!">{p.envVar}</Mono>
                    <span>{configured ? "set" : "missing"}</span>
                    {isActive && (
                      <span>
                        · {catalog.length} model
                        {catalog.length === 1 ? "" : "s"}
                      </span>
                    )}
                  </p>
                </div>

                <div className="shrink-0">
                  {isActive ? (
                    <span className="text-muted inline-flex items-center gap-1.5 text-[13px]">
                      <Check className="h-4 w-4" />
                      In use
                    </span>
                  ) : configured ? (
                    <form action={switchProvider}>
                      <input type="hidden" name="provider" value={p.id} />
                      <SubmitButton pendingLabel="Switching…">
                        Use {p.label}
                      </SubmitButton>
                    </form>
                  ) : (
                    // No key means nothing to switch to — a live button here
                    // would only ever bounce off the action's own check.
                    <span className="text-subtle text-[12.5px]">
                      Set the key to enable
                    </span>
                  )}
                </div>
              </li>
            );
          })}
        </ListBox>
      </div>

      {stranded.length > 0 && (
        <Alert
          tone="warn"
          title={`${stranded.length} workflow${
            stranded.length === 1 ? "" : "s"
          } pinned to a model this provider can't serve`}
        >
          <p>
            Their runs will fail until you pick a different model on each one.
          </p>
          <ul className="mt-2 space-y-1">
            {stranded.map((w) => (
              <li key={w.id} className="flex flex-wrap items-center gap-2">
                <TriangleAlert className="h-3.5 w-3.5 shrink-0" />
                <Link
                  href={`/workflows/${w.id}`}
                  className="underline underline-offset-2"
                >
                  {w.name}
                </Link>
                <Mono>{w.model}</Mono>
              </li>
            ))}
          </ul>
        </Alert>
      )}
    </div>
  );
}

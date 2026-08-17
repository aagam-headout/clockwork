import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { Check, KeyRound, TriangleAlert, Trash2 } from "lucide-react";
import { db } from "@/db";
import { workflows } from "@/db/schema";
import { getProviderForUser } from "@/lib/provider";
import { listKeyMeta } from "@/lib/provider-keys";
import { getModelCatalogForUser } from "@/lib/models";
import { PROVIDERS, providerRoutes } from "@/lib/providers";
import {
  addProviderKey,
  removeProviderKey,
  switchProvider,
} from "@/app/settings/actions";
import { SubmitButton, ConfirmSubmitButton } from "@/components/submit-button";
import { Alert, ListBox, Mono, SectionIntro } from "@/components/ui";
import type { AppUser } from "@/lib/auth/user";

/** "3d ago" — key timestamps don't need more precision than that. */
function ago(date: Date | null): string | null {
  if (!date) return null;
  const days = Math.floor((Date.now() - date.getTime()) / 86_400_000);
  if (days < 1) return "today";
  if (days === 1) return "yesterday";
  return `${days}d ago`;
}

/**
 * Which provider serves this account's model calls, and the key paying for it.
 *
 * Clockwork is bring-your-own-key: the operator's credentials never serve
 * anyone's runs. That makes this page load-bearing, not a preference — an
 * account with no key here can't run anything, so the copy explains the
 * bargain instead of just labelling the field.
 */
export async function ModelProviderSection({ user }: { user: AppUser }) {
  const [active, catalog, keys, rows] = await Promise.all([
    getProviderForUser(user.id),
    getModelCatalogForUser(user.id),
    // Metadata only, never a `select()` over the whole table — the
    // ciphertext columns would otherwise ride into the RSC payload, readable
    // in the browser.
    listKeyMeta(user.id),
    db
      .select({
        id: workflows.id,
        name: workflows.name,
        model: workflows.model,
      })
      .from(workflows)
      .where(eq(workflows.userId, user.id))
      .orderBy(desc(workflows.createdAt)),
  ]);

  const keyByProvider = new Map(keys.map((k) => [k.provider, k]));

  // Switching providers doesn't rewrite stored model ids, so a workflow can
  // stay pinned to a model the active provider can't route. Those fail loudly
  // at execution time — say so here while it's still fixable.
  const stranded = rows.filter((w) => !providerRoutes(active, w.model));

  return (
    <div className="grid gap-4 md:gap-6">
      <SectionIntro
        title="Model provider"
        description="Runs use your own key, billed to you and revocable any time. Keys are encrypted on save and never shown again."
      />

      <ListBox as="ul">
        {PROVIDERS.map((p) => {
          const isActive = p.id === active;
          const key = keyByProvider.get(p.id);
          const verified = ago(key?.verifiedAt ?? null);

          /*
           * The paste field is the whole row for a provider with no key,
           * and a closed disclosure for one that has one. Open in both
           * states, it put identical password fields on the page and made
           * "already set up" look like "not set up yet".
           */
          const keyForm = (
            <form action={addProviderKey} className="flex gap-2">
              <input type="hidden" name="provider" value={p.id} />
              <input
                type="password"
                name="apiKey"
                autoComplete="off"
                spellCheck={false}
                placeholder={`Paste your ${p.label} key`}
                className="input min-w-0 flex-1"
              />
              {/* Verified before storage, so a saved key is never broken. */}
              <SubmitButton variant="primary" pendingLabel="Checking…">
                {key ? "Replace" : "Add key"}
              </SubmitButton>
            </form>
          );

          return (
            <li key={p.id} className="px-4 py-3.5">
              <div className="flex flex-wrap items-center gap-3">
                <span
                  className={`rounded-control flex h-9 w-9 shrink-0 items-center justify-center border ${
                    isActive
                      ? "border-accent-line bg-accent-soft text-accent-text"
                      : "border-border bg-surface-2 text-subtle"
                  }`}
                >
                  <KeyRound className="h-4 w-4" />
                </span>

                <div className="min-w-0 flex-1">
                  <span className="inline-flex items-center gap-1.5">
                    <span className="text-foreground text-sm font-medium">
                      {p.label}
                    </span>
                    {isActive && (
                      <span className="text-success-text inline-flex items-center gap-1 text-[12px] font-medium">
                        <Check className="h-3.5 w-3.5" />
                        In use
                      </span>
                    )}
                  </span>
                  <p className="text-subtle mt-1 flex flex-wrap items-center gap-1.5 text-[12px]">
                    {key ? (
                      <>
                        {/* Last four characters only — the one part of a key
                              that may cross to a browser. */}
                        <Mono className="text-[9px]!">••••{key.last4}</Mono>
                        <span>
                          {verified ? `Verified ${verified}` : "Saved"}
                        </span>
                      </>
                    ) : (
                      <a
                        href={p.keyUrl}
                        target="_blank"
                        rel="noreferrer noopener"
                        className="underline underline-offset-2"
                      >
                        Get a key
                      </a>
                    )}
                    {isActive && catalog.length > 0 && (
                      <span>
                        · {catalog.length} model
                        {catalog.length === 1 ? "" : "s"}
                      </span>
                    )}
                  </p>
                </div>

                {/* One action slot, same place in every row. */}
                <div className="flex shrink-0 items-center gap-1.5">
                  {!isActive && key && (
                    <form action={switchProvider}>
                      <input type="hidden" name="provider" value={p.id} />
                      <SubmitButton variant="primary" pendingLabel="Switching…">
                        Use this
                      </SubmitButton>
                    </form>
                  )}

                  {key && (
                    <form action={removeProviderKey}>
                      <input type="hidden" name="provider" value={p.id} />
                      <ConfirmSubmitButton
                        pendingLabel="Removing…"
                        confirmLabel={`Remove ${p.label} key? Workflows using it stop running.`}
                        icon={<Trash2 className="h-3.5 w-3.5" />}
                        title={`Remove ${p.label} key`}
                        size="sm"
                        variant="outline"
                      >
                        {`Remove ${p.label} key`}
                      </ConfirmSubmitButton>
                    </form>
                  )}
                </div>
              </div>

              {/* Indented to sit under the name/meta column, not the icon —
                  flush left made it read as a new row instead of this
                  provider's own disclosure. */}
              {key ? (
                <details className="group mt-3 pl-12">
                  <summary className="text-muted hover:text-foreground w-fit cursor-pointer text-[13px] select-none">
                    Replace key
                  </summary>
                  <div className="mt-2">{keyForm}</div>
                </details>
              ) : (
                <div className="mt-3 pl-12">{keyForm}</div>
              )}
            </li>
          );
        })}
      </ListBox>

      {keys.length === 0 && (
        <Alert tone="warn" title="No key on this account">
          You can still build and save workflows — they just won&apos;t run
          until a key is here.
        </Alert>
      )}

      {stranded.length > 0 && (
        <Alert
          tone="warn"
          title={`${stranded.length} workflow${
            stranded.length === 1 ? "" : "s"
          } on a model this provider can't serve`}
        >
          <p>Pick a different model on each one to get them running again.</p>
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

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
import { Alert, ListBox, Mono } from "@/components/ui";
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
 * Which provider serves this account's model calls, and the key that pays for
 * them.
 *
 * Clockwork is bring-your-own-key: the operator's credentials never serve
 * anyone's runs. That makes this page load-bearing rather than a preference —
 * an account with no key here cannot run anything, which is why the copy
 * explains the bargain instead of just labelling the field.
 */
export async function ModelProviderSection({ user }: { user: AppUser }) {
  const [active, catalog, keys, rows] = await Promise.all([
    getProviderForUser(user.id),
    getModelCatalogForUser(user.id),
    // Metadata only — never a `select()` over the whole table. The ciphertext
    // columns would otherwise ride into the RSC payload, which is readable in
    // the browser.
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

  // Switching providers doesn't rewrite stored model ids, so a workflow can be
  // left pinned to a model the active provider can't route. Those runs fail
  // loudly at execution time — say so here instead, while it's still fixable.
  const stranded = rows.filter((w) => !providerRoutes(active, w.model));

  return (
    <div className="grid gap-4 md:gap-6">
      <div>
        <h2 className="heading-16 text-foreground">Model provider</h2>
        <p className="text-muted mt-1.5 text-sm leading-relaxed">
          Clockwork runs on your own API key — workflow runs and the builder
          assistant alike are billed to you, and you can revoke access at any
          time from the provider&apos;s own dashboard. Keys are encrypted before
          they&apos;re stored and never shown again after you paste them.
        </p>

        <ListBox as="ul" className="mt-4">
          {PROVIDERS.map((p) => {
            const isActive = p.id === active;
            const key = keyByProvider.get(p.id);
            const verified = ago(key?.verifiedAt ?? null);

            return (
              <li key={p.id} className="grid gap-3 px-4 py-3.5">
                <div className="flex flex-wrap items-center gap-3">
                  <span
                    className={`rounded-control flex h-9 w-9 shrink-0 items-center justify-center border ${
                      isActive
                        ? "border-accent/25 bg-accent-soft text-accent-text"
                        : key
                          ? "border-border bg-surface-2 text-subtle"
                          : "border-warn-line bg-warn-soft text-warn-text"
                    }`}
                  >
                    <KeyRound className="h-4 w-4" />
                  </span>

                  <div className="min-w-0 flex-1">
                    <span className="text-foreground text-sm font-medium">
                      {p.label}
                    </span>
                    <p className="text-subtle mt-1 flex flex-wrap items-center gap-1.5 text-[12px]">
                      {key ? (
                        <>
                          {/* Last four characters only — the one part of a key
                              that may cross to a browser. */}
                          <Mono className="text-[9px]!">••••{key.last4}</Mono>
                          <span>
                            {verified ? `verified ${verified}` : "saved"}
                          </span>
                        </>
                      ) : (
                        <span>
                          No key —{" "}
                          <a
                            href={p.keyUrl}
                            target="_blank"
                            rel="noreferrer noopener"
                            className="underline underline-offset-2"
                          >
                            get one
                          </a>
                        </span>
                      )}
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
                    ) : key ? (
                      <form action={switchProvider}>
                        <input type="hidden" name="provider" value={p.id} />
                        <SubmitButton pendingLabel="Switching…">
                          Use {p.label}
                        </SubmitButton>
                      </form>
                    ) : (
                      // Nothing to switch to — a live button here would only
                      // ever bounce off the action's own check.
                      <span className="text-subtle text-[12.5px]">
                        Add a key to enable
                      </span>
                    )}
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <form action={addProviderKey} className="flex flex-1 gap-2">
                    <input type="hidden" name="provider" value={p.id} />
                    <input
                      type="password"
                      name="apiKey"
                      autoComplete="off"
                      spellCheck={false}
                      placeholder={
                        key
                          ? `Replace ${p.label} key`
                          : `Paste your ${p.label} key`
                      }
                      className="input min-w-0 flex-1"
                    />
                    {/* Verified against the provider before it's stored, so a
                        saved key is never a broken one. */}
                    <SubmitButton pendingLabel="Checking…">
                      {key ? "Replace" : "Add key"}
                    </SubmitButton>
                  </form>

                  {key && (
                    <form action={removeProviderKey}>
                      <input type="hidden" name="provider" value={p.id} />
                      <ConfirmSubmitButton
                        pendingLabel="Removing…"
                        confirmLabel={`Remove the ${p.label} key? Workflows using it stop running.`}
                        icon={<Trash2 className="h-3.5 w-3.5" />}
                        title={`Remove ${p.label} key`}
                        size="sm"
                        variant="danger"
                      >
                        {`Remove ${p.label} key`}
                      </ConfirmSubmitButton>
                    </form>
                  )}
                </div>
              </li>
            );
          })}
        </ListBox>
      </div>

      {keys.length === 0 && (
        <Alert tone="warn" title="No API key on this account">
          Workflows won&apos;t run until you add one. Nothing else is blocked —
          you can build and save workflows first.
        </Alert>
      )}

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

import {
  listConnectedAccounts,
  searchToolkits,
  type ToolkitSummary,
} from "@/lib/composio";
import { requireOwner } from "@/lib/auth/require-owner";
import { APP_TIMEZONE } from "@/lib/time";
import { disconnectToolkit } from "@/lib/actions";
import {
  Alert,
  Badge,
  Card,
  EmptyState,
  Mono,
  PageHeader,
  PageShell,
  SectionLabel,
  buttonClass,
  iconButtonClass,
} from "@/components/ui";
import { ConfirmSubmitButton } from "@/components/submit-button";
import { ConnectorBrowser } from "@/components/connector-browser";
import { ToolkitLogo } from "@/components/toolkit-logo";
import { TOOLKIT_LABELS } from "@/lib/toolkit-labels";
import { Plug, Trash2, RefreshCw, ArrowDown } from "lucide-react";

export const dynamic = "force-dynamic";
export const metadata = { title: "Connections" };

type ConnectedRow = {
  id: string;
  slug: string;
  name: string;
  status: string;
  logo?: string;
  createdAt?: string;
};

/** "3d ago" / "Jan 4" — connections are dated, not timed, at this density. */
function since(iso?: string) {
  if (!iso) return null;
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return null;
  const days = Math.floor((Date.now() - then.getTime()) / 86_400_000);
  if (days < 1) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days}d ago`;
  return then.toLocaleDateString("en-US", {
    // The host is UTC in production; the app's day is the one the rest of the
    // UI counts in.
    timeZone: APP_TIMEZONE,
    month: "short",
    day: "numeric",
  });
}

export default async function ConnectionsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; notice?: string; done?: string }>;
}) {
  await requireOwner();

  // `error` is set by `disconnectToolkit` when Composio refuses the delete;
  // `notice` by the connect route when a toolkit needs no auth at all.
  // `done` is the confirmation a completed disconnect leaves behind — the card
  // simply vanishing looked the same as a click that did nothing.
  const { error: actionError, notice, done } = await searchParams;

  let accounts: Awaited<ReturnType<typeof listConnectedAccounts>> = [];
  let catalog: ToolkitSummary[] = [];
  let loadError: string | null = null;

  // The catalog powers the search grid's first paint; a failure there
  // shouldn't hide the accounts that are already connected (or vice versa).
  const [accountsResult, catalogResult] = await Promise.allSettled([
    listConnectedAccounts(),
    searchToolkits("", 12),
  ]);

  if (accountsResult.status === "fulfilled") accounts = accountsResult.value;
  else
    loadError = accountsResult.reason?.message ?? String(accountsResult.reason);

  if (catalogResult.status === "fulfilled") catalog = catalogResult.value;
  else
    loadError ??= catalogResult.reason?.message ?? String(catalogResult.reason);

  // Composio metadata is the source of truth for names/logos; fall back to the
  // slug so an unknown connector still renders sensibly.
  const catalogBySlug = new Map(catalog.map((t) => [t.slug, t]));

  const connected: ConnectedRow[] = accounts
    .map((acc) => {
      const slug = acc.toolkit?.slug ?? "";
      return {
        id: acc.id,
        slug,
        name: catalogBySlug.get(slug)?.name ?? TOOLKIT_LABELS[slug] ?? slug,
        status: acc.status,
        logo: catalogBySlug.get(slug)?.logo,
        createdAt: acc.createdAt,
      };
    })
    .filter((row) => row.slug)
    // Anything not ACTIVE needs the user's attention, so it sorts to the top.
    .sort(
      (a, b) =>
        Number(a.status === "ACTIVE") - Number(b.status === "ACTIVE") ||
        a.name.localeCompare(b.name),
    );

  const activeCount = connected.filter((c) => c.status === "ACTIVE").length;
  const attentionCount = connected.length - activeCount;

  return (
    <PageShell>
      <PageHeader
        title="Connections"
        subtitle="Link any app in the Composio catalog, then use its tools in a workflow."
        actions={
          <>
            <Badge tone={activeCount > 0 ? "success" : "neutral"} dot>
              {activeCount} active
            </Badge>
            {attentionCount > 0 && (
              <Badge tone="warn" dot>
                {attentionCount} pending
              </Badge>
            )}
          </>
        }
      />

      {notice && (
        <div className="rise mt-6">
          <Alert tone="accent" title="No connection needed">
            {notice}
          </Alert>
        </div>
      )}

      {done && !actionError && (
        <div className="rise mt-6">
          <Alert tone="success">{done}</Alert>
        </div>
      )}

      {actionError && (
        <div className="rise mt-6">
          <Alert tone="danger" title="Composio rejected that">
            {actionError}
          </Alert>
        </div>
      )}

      {loadError && (
        <div className="rise mt-6">
          <Alert tone="danger" title="Composio request failed">
            {loadError}
          </Alert>
        </div>
      )}

      {/* No stat tiles here: the counts they carried are the same two numbers
          the header badges already show, and each card states its own status. */}
      <section className="rise mt-8">
        <SectionLabel
          count={connected.length || undefined}
          headingClassName="heading-16"
        >
          Connected
        </SectionLabel>

        {connected.length === 0 ? (
          <EmptyState
            icon={Plug}
            title="Nothing connected yet"
            description="Connect an app and its tools become available to every workflow."
            action={
              <a href="#add" className={buttonClass("primary", "sm")}>
                <ArrowDown className="h-4 w-4" />
                Browse connectors
              </a>
            }
          />
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {connected.map((row) => {
              const active = row.status === "ACTIVE";
              const added = since(row.createdAt);
              return (
                <Card
                  key={row.id}
                  interactive
                  className="flex flex-col gap-2 p-3"
                >
                  <div className="flex items-start gap-2.5">
                    <ToolkitLogo
                      slug={row.slug}
                      name={row.name}
                      logo={row.logo}
                      size="lg"
                      connected={active}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="heading-14 text-foreground truncate">
                        {row.name}
                      </div>
                      <div className="text-subtle mt-0.5 truncate font-mono text-[11px]">
                        {row.slug}
                      </div>
                    </div>
                    <Badge tone={active ? "success" : "warn"} dot>
                      {row.status.toLowerCase()}
                    </Badge>
                  </div>

                  <div className="flex items-center gap-2">
                    <span className="text-subtle truncate text-[11px]">
                      {added ? `Added ${added}` : " "}
                    </span>
                    <div className="flex-1" />
                    {/*
                     * Icon-only, but real buttons: 24px squares with a border,
                     * always visible. The previous pass had them as 14px glyphs
                     * in borderless controls that only faded in on hover, which
                     * is what made them unreadable — the frame is doing the
                     * work here, not the label.
                     */}
                    <div className="flex shrink-0 items-center gap-1.5">
                      <a
                        href={`/api/connections/${row.slug}/connect`}
                        title={active ? "Reconnect" : "Finish connecting"}
                        aria-label={`Reconnect ${row.name}`}
                        className={iconButtonClass(
                          active ? "outline" : "primary",
                          "xs",
                        )}
                      >
                        <RefreshCw className="h-3 w-3" />
                      </a>
                      <form
                        action={async () => {
                          "use server";
                          await disconnectToolkit(row.id);
                        }}
                      >
                        {/* Disconnect deletes the connected account, so the
                            trash glyph says what actually happens — `Unplug`
                            and `Unlink` both read as "temporarily detached". */}
                        {/* Arms before it fires: this deletes the connected
                            account at Composio, and every workflow reading
                            that app stops working the moment it's gone. */}
                        <ConfirmSubmitButton
                          pendingLabel="Removing…"
                          confirmLabel={`Disconnect ${row.name}?`}
                          icon={<Trash2 className="h-3 w-3" />}
                          title={`Disconnect ${row.name}`}
                          size="xs"
                          variant="danger"
                        >
                          {`Disconnect ${row.name}`}
                        </ConfirmSubmitButton>
                      </form>
                    </div>
                  </div>
                </Card>
              );
            })}
          </div>
        )}
      </section>

      <section id="add" className="rise mt-10 scroll-mt-8">
        {/* The heading travels with the search field and chips — the browser
            keeps them together in one sticky block. */}
        <ConnectorBrowser
          header={
            <SectionLabel
              headingClassName="heading-16"
              action={
                <span className="text-subtle hidden text-[11px] sm:inline">
                  Press <Mono>/</Mono> to search
                </span>
              }
            >
              Add a connector
            </SectionLabel>
          }
          connectedSlugs={connected
            .filter((c) => c.status === "ACTIVE")
            .map((c) => c.slug)}
          initialItems={catalog}
        />
      </section>
    </PageShell>
  );
}

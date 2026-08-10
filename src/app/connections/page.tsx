import {
  listConnectedAccounts,
  searchToolkits,
  type ToolkitSummary,
} from "@/lib/composio";
import { requireOwner } from "@/lib/auth/require-owner";
import { disconnectToolkit } from "@/lib/actions";
import {
  Alert,
  Badge,
  Card,
  EmptyState,
  PageHeader,
  PageShell,
  SectionLabel,
  buttonClass,
} from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { ConnectorBrowser } from "@/components/connector-browser";
import { ToolkitLogo } from "@/components/toolkit-logo";
import { TOOLKIT_LABELS } from "@/lib/toolkit-labels";
import { Plug, Unplug, RefreshCw } from "lucide-react";

export const dynamic = "force-dynamic";

type ConnectedRow = {
  id: string;
  slug: string;
  name: string;
  status: string;
  logo?: string;
  createdAt?: string;
};

export default async function ConnectionsPage() {
  await requireOwner();

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
    .sort((a, b) => a.name.localeCompare(b.name));

  const activeCount = connected.filter((c) => c.status === "ACTIVE").length;

  return (
    <PageShell>
      <PageHeader
        title="Connections"
        subtitle="Any app in the Composio catalog."
        actions={
          <Badge tone={activeCount > 0 ? "success" : "warn"} dot>
            {activeCount} active
          </Badge>
        }
      />

      {loadError && (
        <div className="mt-6">
          <Alert tone="danger" title="Composio request failed">
            {loadError}
          </Alert>
        </div>
      )}

      <section className="rise mt-6">
        <SectionLabel count={connected.length || undefined}>
          Connected
        </SectionLabel>

        {connected.length === 0 ? (
          <EmptyState
            icon={Plug}
            title="Nothing connected yet"
            description="Search below to link your first app."
          />
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {connected.map((row) => {
              const active = row.status === "ACTIVE";
              return (
                <Card
                  key={row.id}
                  interactive
                  className="flex items-center gap-3 p-3"
                >
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
                    <div className="flex items-center gap-1.5">
                      <span
                        className={`font-mono text-[11px] ${active ? "text-success-text" : "text-warn-text"}`}
                      >
                        {row.status.toLowerCase()}
                      </span>
                      <span className="text-subtle truncate font-mono text-[11px]">
                        {row.slug}
                      </span>
                    </div>
                  </div>

                  <div className="flex shrink-0 items-center gap-1">
                    <a
                      href={`/api/connections/${row.slug}/connect`}
                      title="Reconnect"
                      aria-label={`Reconnect ${row.name}`}
                      className={buttonClass("ghost", "sm", "w-8 px-0")}
                    >
                      <RefreshCw className="h-3.5 w-3.5" />
                    </a>
                    <form
                      action={async () => {
                        "use server";
                        await disconnectToolkit(row.id);
                      }}
                    >
                      <SubmitButton
                        pendingLabel="…"
                        variant="ghost"
                        icon={Unplug}
                        iconOnly
                        danger
                        title={`Disconnect ${row.name}`}
                      >
                        Disconnect
                      </SubmitButton>
                    </form>
                  </div>
                </Card>
              );
            })}
          </div>
        )}
      </section>

      <section className="rise mt-10">
        <SectionLabel>Add a connector</SectionLabel>
        <ConnectorBrowser
          connectedSlugs={connected
            .filter((c) => c.status === "ACTIVE")
            .map((c) => c.slug)}
          initialItems={catalog}
        />
      </section>
    </PageShell>
  );
}

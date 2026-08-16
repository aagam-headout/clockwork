import { after } from "next/server";
import { searchToolkits, type ToolkitSummary } from "@/lib/composio";
import { requireUser } from "@/lib/auth/user";
import {
  CONNECTION_STATUS_LABEL,
  dependentCountsByToolkit,
  getUserConnections,
  type ConnectionStatus,
} from "@/lib/data/connections";
import { reconcileUserIfStale } from "@/lib/reconcile";
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
import { DismissibleAlert } from "@/components/dismissible-alert";
import { ConnectorBrowser } from "@/components/connector-browser";
import { ToolkitLogo } from "@/components/toolkit-logo";
import { TOOLKIT_LABELS } from "@/lib/toolkit-labels";
import { Plug, Trash2, RefreshCw, ArrowDown } from "lucide-react";

export const dynamic = "force-dynamic";
export const metadata = { title: "Connections" };

type ConnectedRow = {
  slug: string;
  name: string;
  status: ConnectionStatus;
  usable: boolean;
  statusReason: string | null;
  dependents: number;
  logo?: string;
  connectedAt?: Date | null;
};

/** "3d ago" / "Jan 4" — connections are dated, not timed, at this density. */
function since(value?: Date | string | null) {
  if (!value) return null;
  const then = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(then.getTime())) return null;
  const days = Math.floor((Date.now() - then.getTime()) / 86_400_000);
  if (days < 1) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days}d ago`;
  return then.toLocaleDateString("en-US", {
    // The host is UTC in production; app's day is what the rest of the UI
    // counts in.
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
  const user = await requireUser();

  // `error`: set by `disconnectToolkit` when Composio refuses the delete.
  // `notice`: set by the connect route when a toolkit needs no auth.
  // `done`: confirms a completed disconnect — the card just vanishing looked
  // the same as a click that did nothing.
  const { error: actionError, notice, done } = await searchParams;

  /*
   * Connection state comes from Postgres, so this page renders even when
   * Composio is unreachable — only the catalog (names, logos, browse grid)
   * needs the API, and a failure there is cosmetic.
   */
  const [rows, dependents, catalogResult] = await Promise.all([
    getUserConnections(user.id),
    dependentCountsByToolkit(user.id),
    // Only this one can fail in a way worth reporting; the other two are
    // local reads — a real database failure belongs on the error boundary.
    searchToolkits("", 12).then(
      (items) => ({ items, error: null as string | null }),
      (err: unknown) => ({
        items: [] as ToolkitSummary[],
        error: err instanceof Error ? err.message : String(err),
      }),
    ),
  ]);

  const catalog = catalogResult.items;
  const loadError = catalogResult.error;

  /*
   * Self-healing, after the response goes out: anything not checked against
   * Composio recently gets refreshed for the next render, so a visit never
   * pays for a round trip to show state we already have.
   */
  after(() =>
    reconcileUserIfStale(user.id).catch((err) =>
      console.error("[connections] background reconcile failed", err),
    ),
  );

  // Composio metadata is the source of truth for names/logos; fall back to the
  // slug so an unknown connector still renders sensibly.
  const catalogBySlug = new Map(catalog.map((t) => [t.slug, t]));

  const connected: ConnectedRow[] = rows
    .filter((row) => row.status !== "disconnected")
    .map((row) => ({
      slug: row.toolkit,
      name:
        catalogBySlug.get(row.toolkit)?.name ??
        TOOLKIT_LABELS[row.toolkit] ??
        row.toolkit,
      status: row.status,
      usable: row.usable,
      statusReason: row.statusReason,
      dependents: dependents.get(row.toolkit) ?? 0,
      logo: catalogBySlug.get(row.toolkit)?.logo,
      connectedAt: row.connectedAt,
    }))
    // Anything that isn't usable needs the user's attention, so it sorts up.
    .sort(
      (a, b) =>
        Number(a.usable) - Number(b.usable) || a.name.localeCompare(b.name),
    );

  const activeCount = connected.filter((c) => c.usable).length;
  const attentionCount = connected.length - activeCount;

  return (
    <PageShell>
      <PageHeader
        title="Connections"
        subtitle="Apps your workflows can act on."
        actions={
          <>
            <Badge tone={activeCount > 0 ? "success" : "neutral"} dot>
              {activeCount} connected
            </Badge>
            {/* Not "pending": these are expired, revoked or failed grants, and
                "pending" reads as "wait and it'll sort itself out". */}
            {attentionCount > 0 && (
              <Badge tone="warn" dot>
                {attentionCount} need attention
              </Badge>
            )}
          </>
        }
      />

      {notice && (
        <div className="rise mt-6">
          <DismissibleAlert
            tone="accent"
            title="No connection needed"
            params={["notice"]}
          >
            {notice}
          </DismissibleAlert>
        </div>
      )}

      {done && !actionError && (
        <div className="rise mt-6">
          <DismissibleAlert tone="success" params={["done"]}>
            {done}
          </DismissibleAlert>
        </div>
      )}

      {actionError && (
        <div className="rise mt-6">
          <DismissibleAlert
            tone="danger"
            title="Composio rejected that"
            params={["error"]}
          >
            {actionError}
          </DismissibleAlert>
        </div>
      )}

      {loadError && (
        <div className="rise mt-6">
          <Alert tone="danger" title="Composio request failed">
            {loadError}
          </Alert>
        </div>
      )}

      {/* No stat tiles: the counts they'd carry are the same two numbers the
          header badges already show, and each card states its own status. */}
      <section className="rise mt-8">
        <SectionLabel
          count={connected.length || undefined}
          headingClassName="heading-16"
        >
          {/* Not "Connected" — every card carries a status chip, and one of
              those chips says "Connected" too. */}
          Your apps
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
              const active = row.usable;
              const added = since(row.connectedAt);
              return (
                <Card
                  key={row.slug}
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
                    {/* The slug used to sit under the name on its own line —
                        three text lines per card for two facts. That's the
                        tooltip's job, not the card's. */}
                    <div className="min-w-0 flex-1 self-center">
                      <div
                        className="heading-14 text-foreground truncate"
                        title={row.slug}
                      >
                        {row.name}
                      </div>
                    </div>
                    <Badge tone={active ? "success" : "warn"} dot>
                      {CONNECTION_STATUS_LABEL[row.status]}
                    </Badge>
                  </div>

                  {/* The reason Composio gave, when there is one — "expired"
                      on its own doesn't tell anyone what to do about it. */}
                  {!active && row.statusReason && (
                    <p className="text-warn-text text-[11px] leading-snug">
                      {row.statusReason}
                    </p>
                  )}

                  <div className="flex items-center gap-2">
                    <span className="text-subtle truncate text-[11px]">
                      {[
                        added && `Added ${added}`,
                        row.dependents > 0 &&
                          `${row.dependents} workflow${row.dependents === 1 ? "" : "s"}`,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                    <div className="flex-1" />
                    {/*
                     * Icon-only, but real buttons: 24px squares with a border,
                     * always visible. The previous pass used 14px glyphs in
                     * borderless controls that only faded in on hover —
                     * unreadable. The frame does the work here, not the label.
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
                          // The toolkit slug, not a Composio account id: the
                          // action resolves the account from (user, toolkit)
                          // so the ownership check is the lookup itself.
                          await disconnectToolkit(row.slug);
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
                          confirmLabel={
                            row.dependents > 0
                              ? `Disconnect ${row.name}? ${row.dependents} workflow${
                                  row.dependents === 1 ? "" : "s"
                                } use it and will be paused.`
                              : `Disconnect ${row.name}?`
                          }
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
          connectedSlugs={connected.filter((c) => c.usable).map((c) => c.slug)}
          initialItems={catalog}
        />
      </section>
    </PageShell>
  );
}

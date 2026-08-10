import { listConnectedAccounts, TOOLKITS, type Toolkit } from "@/lib/composio";
import { requireOwner } from "@/lib/auth/require-owner";
import { cardClass } from "@/lib/card-class";
import { ConnectionsIcon } from "@/components/icons";

export const dynamic = "force-dynamic";

const TOOLKIT_LABELS: Record<Toolkit, string> = {
  googlecalendar: "Google Calendar",
  gmail: "Gmail",
  slack: "Slack",
  notion: "Notion",
  github: "GitHub",
};

export default async function ConnectionsPage() {
  await requireOwner();

  let accounts: Awaited<ReturnType<typeof listConnectedAccounts>> = [];
  let loadError: string | null = null;
  try {
    accounts = await listConnectedAccounts();
  } catch (err) {
    loadError = err instanceof Error ? err.message : String(err);
  }

  const statusByToolkit = new Map<string, string>();
  for (const acc of accounts) {
    const slug = acc.toolkit?.slug;
    if (slug) statusByToolkit.set(slug, acc.status);
  }

  return (
    <main className="mx-auto max-w-3xl px-8 py-12">
      <h1 className="text-xl font-medium tracking-tight text-foreground">Connections</h1>
      <p className="mt-1 text-sm text-muted">Connect the apps your workflows can read from.</p>

      {loadError && (
        <p className="mt-6 rounded-xl border border-red-900/40 bg-red-950/30 px-4 py-3 text-sm text-red-400">
          Couldn&apos;t load connection status: {loadError}
        </p>
      )}

      <div className="mt-8 grid grid-cols-1 gap-3 sm:grid-cols-2">
        {TOOLKITS.map((toolkit) => {
          const status = statusByToolkit.get(toolkit);
          const active = status === "ACTIVE";
          return (
            <div key={toolkit} className={cardClass()}>
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-chip">
                    <ConnectionsIcon className="h-4 w-4 text-muted" />
                  </div>
                  <div>
                    <div className="text-sm font-medium text-foreground">
                      {TOOLKIT_LABELS[toolkit]}
                    </div>
                    <div className="text-xs text-muted">
                      {active ? "Connected" : status ? status.toLowerCase() : "Not connected"}
                    </div>
                  </div>
                </div>
                {active ? (
                  <span className="shrink-0 rounded-full bg-emerald-950/50 px-2.5 py-1 text-xs font-medium text-emerald-400">
                    Active
                  </span>
                ) : (
                  <a
                    href={`/api/connections/${toolkit}/connect`}
                    className="shrink-0 cursor-pointer rounded-md bg-foreground px-3 py-1.5 text-xs font-medium text-background transition-opacity hover:opacity-85"
                  >
                    Connect
                  </a>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </main>
  );
}

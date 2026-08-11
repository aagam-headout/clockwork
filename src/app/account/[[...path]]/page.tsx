import { redirect } from "next/navigation";
import { AccountView } from "@neondatabase/auth-ui";
import { requireUser } from "@/lib/auth/user";
import { AccountNav } from "@/components/account-nav";
import { ModelProviderSection } from "@/components/model-provider-section";
import { Alert, PageHeader, PageShell } from "@/components/ui";

export const dynamic = "force-dynamic";

const TABS = ["settings", "security", "model-provider"] as const;
type Tab = (typeof TABS)[number];

function isTab(value: string | undefined): value is Tab {
  return !!value && (TABS as readonly string[]).includes(value);
}

// Neon Auth's UserButton menu links to `${account.basePath}/${SETTINGS}` —
// i.e. /account/settings, and /account/security from AccountView's own nav.
// `model-provider` is our own tab, not one Auth-UI knows about — see AccountNav.
// Without this catch-all those links 404. Bare /account, or any path Auth-UI
// and we don't recognise, has no view of its own, so it redirects to settings.
export default async function AccountPage({
  params,
  searchParams,
}: {
  params: Promise<{ path?: string[] }>;
  searchParams: Promise<{ error?: string; notice?: string }>;
}) {
  await requireUser();

  const { path } = await params;
  const tab = path?.[path.length - 1];
  if (!isTab(tab)) redirect("/account/settings");

  const { error, notice } = await searchParams;

  return (
    <PageShell>
      {/* No subtitle: it listed the three tabs sitting directly underneath. */}
      <PageHeader title="Account" backHref="/" backLabel="Overview" />

      {error && (
        <div className="mt-6">
          <Alert tone="danger">{error}</Alert>
        </div>
      )}
      {notice && (
        <div className="mt-6">
          <Alert tone="accent">{notice}</Alert>
        </div>
      )}

      <div className="mt-6 flex w-full flex-col gap-4 md:mt-8 md:flex-row md:gap-12">
        <AccountNav />

        <div className="min-w-0 flex-1">
          {tab === "model-provider" ? (
            <ModelProviderTab />
          ) : (
            // `auth-surface` re-points the two shadcn token names that mean
            // something else in our scale — see the Neon Auth bridge in
            // globals.css. `hideNav`: AccountNav above is this section's only
            // nav now, so Auth-UI's own (which can't include our extra tab)
            // stays off.
            <div className="auth-surface rise">
              <AccountView
                hideNav
                view={tab === "security" ? "SECURITY" : "SETTINGS"}
              />
            </div>
          )}
        </div>
      </div>
    </PageShell>
  );
}

async function ModelProviderTab() {
  const user = await requireUser();
  return <ModelProviderSection user={user} />;
}

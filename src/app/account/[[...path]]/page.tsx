import { redirect } from "next/navigation";
import { AccountView } from "@neondatabase/auth-ui";
import { requireUser } from "@/lib/auth/user";
import { AccountNav } from "@/components/account-nav";
import { ModelProviderSection } from "@/components/model-provider-section";
import { PageHeader, PageShell } from "@/components/ui";
import { DismissibleAlert } from "@/components/dismissible-alert";

export const dynamic = "force-dynamic";

const TABS = ["settings", "security", "model-provider"] as const;
type Tab = (typeof TABS)[number];

function isTab(value: string | undefined): value is Tab {
  return !!value && (TABS as readonly string[]).includes(value);
}

// Neon Auth's UserButton links to `${account.basePath}/${SETTINGS}` (i.e.
// /account/settings) and /account/security via AccountView's own nav.
// `model-provider` is our own tab, unknown to Auth-UI — see AccountNav.
// Without this catch-all those links 404; bare /account or any unrecognised
// path redirects to settings.
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
          <DismissibleAlert tone="danger" params={["error"]}>
            {error}
          </DismissibleAlert>
        </div>
      )}
      {notice && (
        <div className="mt-6">
          <DismissibleAlert tone="accent" params={["notice"]}>
            {notice}
          </DismissibleAlert>
        </div>
      )}

      <div className="mt-6 flex w-full flex-col gap-4 md:mt-8 md:flex-row md:gap-12">
        <AccountNav />

        <div className="min-w-0 flex-1">
          {tab === "model-provider" ? (
            <ModelProviderTab />
          ) : (
            // `auth-surface` remaps two shadcn token names that mean something
            // else in our scale — see the Neon Auth bridge in globals.css.
            // `hideNav`: AccountNav is this section's only nav now, so
            // Auth-UI's own (which can't include our extra tab) stays off.
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

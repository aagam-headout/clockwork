import { redirect } from "next/navigation";
import {
  AccountSettingsCards,
  SecuritySettingsCards,
} from "@neondatabase/auth-ui";
import { requireUser } from "@/lib/auth/user";
import { AccountNav } from "@/components/account-nav";
import { ModelProviderSection } from "@/components/model-provider-section";
import { WorkflowDefaultsSection } from "@/components/workflow-defaults-section";
import { PageHeader, PageShell, SectionIntro } from "@/components/ui";
import { DismissibleAlert } from "@/components/dismissible-alert";

export const dynamic = "force-dynamic";

const TABS = ["settings", "model-provider", "workflow-defaults"] as const;
type Tab = (typeof TABS)[number];

function isTab(value: string | undefined): value is Tab {
  return !!value && (TABS as readonly string[]).includes(value);
}

// Neon Auth's UserButton links to `${account.basePath}/${SETTINGS}` (i.e.
// /account/settings) and /account/security. Profile and security now render
// together under /account/settings (see below), so /account/security simply
// falls through `isTab` and redirects there like any unrecognised path.
// `model-provider` and `workflow-defaults` are our own tabs, unknown to
// Auth-UI — see AccountNav.
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
          ) : tab === "workflow-defaults" ? (
            <WorkflowDefaultsTab />
          ) : (
            // `auth-surface` remaps two shadcn token names that mean something
            // else in our scale — see the Neon Auth bridge in globals.css.
            // Profile and security used to be separate Auth-UI views/tabs;
            // now both card groups render together on this one tab, under the
            // section intro every tab opens with.
            <div className="grid gap-4 md:gap-6">
              <SectionIntro
                title="Profile & security"
                description="Your name, email, and how you sign in."
              />
              <div className="auth-surface rise grid gap-4 md:gap-6">
                <AccountSettingsCards />
                <SecuritySettingsCards />
              </div>
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

async function WorkflowDefaultsTab() {
  const user = await requireUser();
  return <WorkflowDefaultsSection user={user} />;
}

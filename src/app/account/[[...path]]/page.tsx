import { redirect } from "next/navigation";
import { AccountView } from "@neondatabase/auth-ui";
import { requireOwner } from "@/lib/auth/require-owner";
import { PageHeader } from "@/components/ui";

export const dynamic = "force-dynamic";

// Neon Auth's UserButton menu links to `${account.basePath}/${SETTINGS}` —
// i.e. /account/settings, and /account/security from AccountView's own nav.
// Without this catch-all those links 404. Bare /account has no view of its
// own, so it redirects to the settings tab.
export default async function AccountPage({
  params,
}: {
  params: Promise<{ path?: string[] }>;
}) {
  await requireOwner();

  const { path } = await params;
  if (!path?.length) redirect("/account/settings");

  return (
    <main className="mx-auto max-w-4xl px-4 py-8 md:px-6 md:py-10">
      <PageHeader
        title="Account"
        subtitle="Your profile, email, and sign-in security."
        backHref="/"
        backLabel="Overview"
      />
      <div className="rise mt-6">
        <AccountView path={path[path.length - 1]} />
      </div>
    </main>
  );
}

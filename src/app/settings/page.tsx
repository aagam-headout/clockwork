import { redirect } from "next/navigation";

// Model provider moved under Account (a per-account credential, like
// email/password) — see /account/[[...path]]/page.tsx. This route stays so
// old bookmarks and pre-move `switchProvider` callers don't 404; it forwards
// the query string.
export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const params = new URLSearchParams(
    Object.entries(await searchParams).filter(
      (entry): entry is [string, string] => entry[1] != null,
    ),
  );
  const qs = params.toString();
  redirect(`/account/model-provider${qs ? `?${qs}` : ""}`);
}

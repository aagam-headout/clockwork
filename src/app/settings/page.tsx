import { redirect } from "next/navigation";

// Model provider moved under Account (it's a per-account credential choice,
// same as email or password) — see /account/[[...path]]/page.tsx. This route
// stays only so old bookmarks and the `switchProvider` action's pre-move
// callers don't 404; it forwards along whatever query string it got.
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

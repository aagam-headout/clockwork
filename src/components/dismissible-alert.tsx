"use client";

import { useRouter } from "next/navigation";
import { Alert } from "@/components/ui";

/*
 * A banner whose text arrived as a query param (?error=…, ?notice=…, ?done=…).
 * Closing it strips those params from the URL, so the message doesn't come
 * back on refresh or when the browser restores the page from history.
 */
export function DismissibleAlert({
  tone,
  title,
  params,
  children,
}: {
  tone?: "neutral" | "accent" | "success" | "danger" | "warn";
  title?: string;
  /** Query params this banner was rendered from; cleared on close. */
  params: string[];
  children: React.ReactNode;
}) {
  const router = useRouter();

  function dismiss() {
    // Read from `window`, not `useSearchParams` — that would force every
    // page with a banner behind a Suspense boundary.
    const url = new URL(window.location.href);
    for (const key of params) url.searchParams.delete(key);
    const pathname = url.pathname;
    const query = url.searchParams.toString();
    // `replace` so Back can't step into the dismissed banner; no scroll
    // reset since it's already at the top of the page.
    router.replace(query ? `${pathname}?${query}` : pathname, {
      scroll: false,
    });
  }

  return (
    <Alert tone={tone} title={title} onDismiss={dismiss}>
      {children}
    </Alert>
  );
}

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
    // Read the URL off `window` rather than `useSearchParams`, which would
    // force every page holding a banner behind a Suspense boundary.
    const url = new URL(window.location.href);
    for (const key of params) url.searchParams.delete(key);
    const pathname = url.pathname;
    const query = url.searchParams.toString();
    // `replace` so Back doesn't step straight into the dismissed banner, and
    // no scroll reset — the banner sits at the top of a page already there.
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

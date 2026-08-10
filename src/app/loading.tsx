import { PageShell, Skeleton } from "@/components/ui";

/*
 * Every page in this app is force-dynamic and talks to Postgres (and often
 * Composio) before it can render, so the default was a blank frame on each
 * navigation. One shared skeleton in the shape all the pages share — header,
 * stat row, list — covers the whole tree; nothing here needs to be per-route
 * accurate, only structurally honest.
 */
export default function Loading() {
  return (
    <PageShell>
      <span className="sr-only">Loading…</span>

      <Skeleton className="h-8 w-48" />
      <Skeleton className="mt-2 h-4 w-64" />

      <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="rounded-container h-[86px]" />
        ))}
      </div>

      <div className="mt-8 flex flex-col gap-4">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="rounded-container h-24" />
        ))}
      </div>
    </PageShell>
  );
}

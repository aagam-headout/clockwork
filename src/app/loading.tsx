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

      {/* 32px title + 20px subtitle, the exact block PageHeader renders. */}
      <Skeleton className="h-8 w-48" />
      <Skeleton className="mt-2 h-5 w-72" />

      {/* Same grid and 92px floor as the Stat row it stands in for, so the
          real tiles land on the boxes the eye already fixed on. */}
      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {[0, 1, 2, 3, 4].map((i) => (
          <Skeleton key={i} className="rounded-container h-[92px]" />
        ))}
      </div>

      {/* Every list in the app is one bordered box of hairline rows, not a
          stack of detached cards — a section label above it, then the box. */}
      <div className="mt-8">
        <Skeleton className="h-4 w-28" />
        <div className="divide-border border-border rounded-container mt-3 divide-y overflow-hidden border">
          {[0, 1, 2, 3, 4].map((i) => (
            <div key={i} className="flex items-center gap-3 px-4 py-3.5">
              <Skeleton className="rounded-control h-8 w-8 shrink-0" />
              <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                <Skeleton className="h-3.5 w-[40%]" />
                <Skeleton className="h-3 w-[22%]" />
              </div>
              <Skeleton className="rounded-chip h-[22px] w-16 shrink-0" />
            </div>
          ))}
        </div>
      </div>
    </PageShell>
  );
}

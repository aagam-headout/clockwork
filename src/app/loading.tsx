import { PageShell, Skeleton } from "@/components/ui";

/*
 * Every page here is force-dynamic and hits Postgres (often Composio too)
 * before rendering, so the default was a blank frame per navigation. One
 * shared skeleton in the common shape — header, stat row, list — covers the
 * whole tree; it only needs to be structurally honest, not per-route accurate.
 */
export default function Loading() {
  return (
    <PageShell>
      <span className="sr-only">Loading…</span>

      {/* 32px title + 20px subtitle, the exact block PageHeader renders. */}
      <Skeleton className="h-8 w-48" />
      <Skeleton className="mt-1.5 h-5 w-72" />

      {/* Same grid and 92px floor as the Stat row, so real tiles land where
          the eye already fixed. */}
      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {[0, 1, 2, 3, 4].map((i) => (
          <Skeleton key={i} className="rounded-container h-[92px]" />
        ))}
      </div>

      {/* Lists here are one bordered box of hairline rows, not detached cards
          — section label above, then the box. */}
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

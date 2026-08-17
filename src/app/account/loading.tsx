import { PageShell, Skeleton } from "@/components/ui";

/*
 * This page is nav rail plus tab content, side by side — nothing like the
 * root skeleton's stat-row-then-list. The rail's three items render
 * instantly in the real page (no data), so only the content side needs to
 * look unsettled; the rail skeleton just holds its width.
 */
export default function Loading() {
  return (
    <PageShell>
      <span className="sr-only">Loading…</span>

      {/* Same 14px back-link row PageHeader renders above the title —
          skipping it left the title 28px higher than the real page. */}
      <div className="mb-3 flex items-center gap-1">
        <Skeleton className="h-3.5 w-3.5" />
        <Skeleton className="h-3.5 w-16" />
      </div>

      <Skeleton className="h-8 w-28" />

      <div className="mt-6 flex w-full flex-col gap-4 md:mt-8 md:flex-row md:gap-12">
        <div className="hidden w-48 shrink-0 flex-col gap-1 md:flex lg:w-60">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="rounded-control h-9 w-full" />
          ))}
        </div>

        <div className="min-w-0 flex-1">
          <Skeleton className="h-5 w-40" />
          <Skeleton className="mt-2 h-4 w-64" />
          <div className="mt-5 flex flex-col gap-4">
            {[0, 1].map((i) => (
              <div
                key={i}
                className="rounded-container border-border border p-5"
              >
                <Skeleton className="h-4 w-32" />
                <div className="mt-4 flex flex-col gap-1.5">
                  <Skeleton className="h-3 w-20" />
                  <Skeleton className="rounded-control h-9 w-full" />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </PageShell>
  );
}

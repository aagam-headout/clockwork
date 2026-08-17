import { Card, ListBox, PageShell, Skeleton } from "@/components/ui";

/*
 * The root skeleton's stat row happens to fit (this page has one too), but
 * everything below it doesn't: an output card, then a trace of compact
 * 36px summary rows — not the app-wide list's 60px avatar rows. Mirrors
 * both so the trace doesn't visibly grow taller once real rows land.
 */
export default function Loading() {
  return (
    <PageShell>
      <span className="sr-only">Loading…</span>

      {/* Same 14px back-link row PageHeader renders above the title —
          skipping it left the title 28px higher than the real page. */}
      <div className="mb-3 flex items-center gap-1">
        <Skeleton className="h-3.5 w-3.5" />
        <Skeleton className="h-3.5 w-12" />
      </div>

      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
        <div className="min-w-0 flex-1">
          <Skeleton className="h-8 w-56" />
          <div className="mt-1.5 flex items-center gap-2">
            <Skeleton className="rounded-chip h-[22px] w-16" />
            <Skeleton className="rounded-chip h-[22px] w-16" />
            <Skeleton className="h-4 w-32" />
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <Skeleton className="rounded-control h-8 w-32" />
        </div>
      </div>

      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {[0, 1, 2, 3, 4].map((i) => (
          <Skeleton key={i} className="rounded-container h-[92px]" />
        ))}
      </div>

      <div className="mt-8">
        <Skeleton className="h-4 w-16" />
        <Card className="mt-3 overflow-hidden">
          <div className="p-5">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="mt-3 h-3.5 w-full" />
            <Skeleton className="mt-2 h-3.5 w-[85%]" />
            <Skeleton className="mt-2 h-3.5 w-[60%]" />
          </div>
          <div className="border-border flex items-center gap-2 border-t px-5 py-2.5">
            <Skeleton className="rounded-chip h-[20px] w-16" />
          </div>
        </Card>
      </div>

      <div className="mt-8">
        <Skeleton className="h-4 w-14" />
        <ListBox className="mt-3">
          {[0, 1, 2, 3, 4, 5, 6].map((i) => (
            <div key={i} className="flex h-9 items-center gap-2.5 px-3">
              <Skeleton className="h-3 w-4 shrink-0" />
              <Skeleton className="h-3.5 w-3.5 shrink-0 rounded-full" />
              <Skeleton className="h-3 w-3 shrink-0" />
              <Skeleton className="h-3 w-40" />
              <span className="flex-1" />
              <Skeleton className="h-3 w-10 shrink-0" />
            </div>
          ))}
        </ListBox>
      </div>
    </PageShell>
  );
}

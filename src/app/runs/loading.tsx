import { ListBox, PageShell, Skeleton } from "@/components/ui";

/*
 * Root skeleton's list is close (hairline rows), but this page has a
 * search/filter bar above the list and no stat row — both are load-bearing
 * enough visually that skipping them still shifted layout on arrival.
 */
export default function Loading() {
  return (
    <PageShell>
      <span className="sr-only">Loading…</span>

      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
        <div className="min-w-0 flex-1">
          <Skeleton className="h-8 w-28" />
          <Skeleton className="mt-1.5 h-5 w-72" />
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <Skeleton className="rounded-chip h-6 w-24" />
        </div>
      </div>

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <Skeleton className="rounded-control h-9 w-64" />
        <div className="flex items-center gap-1.5">
          {[0, 1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="rounded-control h-8 w-16" />
          ))}
        </div>
      </div>

      <div className="mt-8">
        <Skeleton className="h-4 w-16" />
        <ListBox className="mt-3">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="flex items-center gap-3 px-4 py-3">
              <Skeleton className="h-2 w-2 shrink-0 rounded-full" />
              <div className="min-w-0 flex-1">
                <Skeleton className="h-3.5 w-[35%]" />
                <Skeleton className="mt-1.5 h-3 w-[25%]" />
              </div>
              <Skeleton className="h-3 w-12 shrink-0" />
              <Skeleton className="h-3 w-14 shrink-0" />
              <Skeleton className="rounded-chip h-[22px] w-16 shrink-0" />
            </div>
          ))}
        </ListBox>
      </div>
    </PageShell>
  );
}

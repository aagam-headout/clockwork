import { Card, PageShell, Skeleton } from "@/components/ui";

/*
 * No stat row on this page by design (the header badges already carry those
 * counts), and connected apps render as a card grid, not hairline rows — the
 * root skeleton's shape fits neither.
 */
export default function Loading() {
  return (
    <PageShell>
      <span className="sr-only">Loading…</span>

      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
        <div className="min-w-0 flex-1">
          <Skeleton className="h-8 w-44" />
          <Skeleton className="mt-1.5 h-5 w-64" />
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <Skeleton className="rounded-chip h-6 w-28" />
        </div>
      </div>

      <div className="mt-8">
        <Skeleton className="h-4 w-20" />
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <Card key={i} className="flex flex-col gap-2 p-3">
              <div className="flex items-start gap-2.5">
                <Skeleton className="rounded-control h-9 w-9 shrink-0" />
                <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                  <Skeleton className="h-3.5 w-[60%]" />
                  <Skeleton className="rounded-chip h-[20px] w-20" />
                </div>
              </div>
              <Skeleton className="mt-1 h-3 w-[40%]" />
            </Card>
          ))}
        </div>
      </div>
    </PageShell>
  );
}

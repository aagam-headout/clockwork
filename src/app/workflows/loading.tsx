import { Card, PageShell, Skeleton } from "@/components/ui";

/*
 * The root skeleton assumes a stat row and hairline-row list — this page has
 * neither: the header carries its own count badge, and each workflow is a
 * full card (name, goal, toolkit chips, meta line, action row), not a row.
 * Mirrors that so the list doesn't rearrange under itself on load.
 */
export default function Loading() {
  return (
    <PageShell>
      <span className="sr-only">Loading…</span>

      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
        <div className="min-w-0 flex-1">
          <Skeleton className="h-8 w-40" />
          <Skeleton className="mt-1.5 h-5 w-80" />
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <Skeleton className="rounded-chip h-6 w-32" />
          <Skeleton className="rounded-control h-8 w-32" />
        </div>
      </div>

      <div className="mt-6 flex flex-col gap-4">
        {[0, 1, 2].map((i) => (
          <Card key={i} className="p-4 md:p-5">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <Skeleton className="h-3.5 w-3.5 rounded-full" />
                  <Skeleton className="h-4 w-40" />
                  <Skeleton className="h-3.5 w-24" />
                </div>
                <Skeleton className="mt-2 h-4 w-[70%]" />
                <Skeleton className="mt-1.5 h-4 w-[45%]" />
                <div className="mt-3 flex items-center gap-1.5">
                  <Skeleton className="rounded-chip h-[22px] w-20" />
                  <Skeleton className="rounded-chip h-[22px] w-24" />
                </div>
                <Skeleton className="mt-3 h-3.5 w-56" />
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <Skeleton className="rounded-control h-8 w-24" />
                <Skeleton className="rounded-control h-8 w-8" />
                <Skeleton className="rounded-control h-8 w-8" />
                <Skeleton className="rounded-control h-8 w-8" />
              </div>
            </div>
          </Card>
        ))}
      </div>
    </PageShell>
  );
}

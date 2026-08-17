import { ListBox, PageShell, Skeleton } from "@/components/ui";

/*
 * The root skeleton's stat-row-then-list shape doesn't appear here at all —
 * this page opens on the config form (a bordered card, hairline-divided
 * sections, each a heading plus a couple of fields), then a plain recent-runs
 * list below it. Mirrors that instead.
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

      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
        <div className="min-w-0 flex-1">
          <Skeleton className="h-8 w-52" />
          <div className="mt-1.5 flex items-center gap-2">
            <Skeleton className="rounded-chip h-[22px] w-16" />
            <Skeleton className="h-4 w-20" />
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <Skeleton className="rounded-control h-8 w-24" />
          <Skeleton className="rounded-control h-8 w-32" />
        </div>
      </div>

      {/* Section grid is `gap-x-8 gap-y-3` (heading to fields), the fields
          themselves `gap-4` apart — two different gaps, not one. */}
      <div className="rounded-container border-border divide-border mt-6 flex flex-col divide-y border">
        {[
          { label: "w-16", fields: 2 },
          { label: "w-20", fields: 2 },
          { label: "w-24", fields: 3 },
        ].map((section, i) => (
          <div key={i} className="flex flex-col gap-3 p-5">
            <div className="flex items-center gap-2">
              <Skeleton className="h-4 w-4" />
              <Skeleton className={`h-4 ${section.label}`} />
            </div>
            <div className="flex flex-col gap-4">
              {Array.from({ length: section.fields }).map((_, j) => (
                <div key={j} className="flex flex-col gap-1.5">
                  <Skeleton className="h-3 w-20" />
                  <Skeleton className="rounded-control h-9 w-full" />
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="mt-8">
        <Skeleton className="h-4 w-28" />
        <ListBox className="mt-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="flex items-center gap-3 px-4 py-3">
              <Skeleton className="h-2 w-2 shrink-0 rounded-full" />
              <Skeleton className="h-3 w-32 flex-1" />
              <Skeleton className="h-3 w-10 shrink-0" />
              <Skeleton className="rounded-chip h-[22px] w-16 shrink-0" />
              <Skeleton className="rounded-chip h-[22px] w-16 shrink-0" />
            </div>
          ))}
        </ListBox>
      </div>
    </PageShell>
  );
}

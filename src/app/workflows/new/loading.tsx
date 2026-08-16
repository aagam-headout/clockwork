import { PageShell, Skeleton } from "@/components/ui";

/*
 * The builder is two panes, but the app-wide skeleton is header/stat-row/list
 * — a shape this route never renders, causing a rearrange on arrival. This
 * mirrors the real layout: chat card left, settings rail right, at
 * new-workflow-client.tsx's widths.
 */
export default function Loading() {
  return (
    <PageShell fill>
      <span className="sr-only">Loading…</span>

      <Skeleton className="h-8 w-56" />
      <Skeleton className="mt-2 h-5 w-80" />

      <div className="mt-6 grid min-h-0 gap-5 lg:flex-1 lg:grid-cols-[minmax(0,1fr)_344px] xl:grid-cols-[minmax(0,1fr)_380px] xl:gap-6">
        {/* Chat pane: header strip, then composer pinned to the bottom —
            the two constants across visits. */}
        <div className="rounded-container border-border flex h-[min(62vh,520px)] flex-col justify-between border p-4 lg:h-full">
          <div className="flex items-center gap-2">
            <Skeleton className="rounded-control h-7 w-7" />
            <Skeleton className="h-4 w-20" />
            <div className="flex-1" />
            <Skeleton className="rounded-control h-8 w-28" />
          </div>
          <div className="flex flex-col gap-1.5">
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-9 w-11/12" />
            <Skeleton className="h-9 w-10/12" />
          </div>
          <Skeleton className="rounded-container h-[76px] w-full" />
        </div>

        {/* Settings rail: label + field, three times over. */}
        <div className="rounded-container border-border hidden flex-col gap-5 border p-4 lg:flex">
          <div className="flex items-center gap-2">
            <Skeleton className="h-4 w-4" />
            <Skeleton className="h-4 w-16" />
          </div>
          {[0, 1, 2].map((i) => (
            <div key={i} className="flex flex-col gap-2">
              <Skeleton className="h-3 w-20" />
              <Skeleton className="rounded-control h-9 w-full" />
            </div>
          ))}
          <Skeleton className="rounded-control h-24 w-full" />
        </div>
      </div>
    </PageShell>
  );
}

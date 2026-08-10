import { Skeleton } from "@/components/ui";

/*
 * Every page in this app is force-dynamic and talks to Postgres (and often
 * Composio) before it can render, so the default was a blank frame on each
 * navigation. One shared skeleton in the shape all the pages share — header,
 * stat row, list — covers the whole tree; nothing here needs to be per-route
 * accurate, only structurally honest.
 */
export default function Loading() {
  return (
    <main className="mx-auto max-w-6xl px-4 py-8 md:px-6 md:py-10" aria-busy>
      <span className="sr-only">Loading…</span>

      <Skeleton className="h-8 w-48" />
      <Skeleton className="mt-2 h-4 w-64" />

      <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-[86px] rounded-container" />
        ))}
      </div>

      <div className="mt-8 flex flex-col gap-4">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-24 rounded-container" />
        ))}
      </div>
    </main>
  );
}

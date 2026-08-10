"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * A run is queued or in flight, and the page that shows it is a server
 * component — so the only way its trace grows in front of you is to re-fetch
 * it. Polling stops the moment the run reaches a terminal status, so a
 * finished run costs nothing.
 */
export function LiveRun({ active }: { active: boolean }) {
  const router = useRouter();

  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => router.refresh(), 3000);
    return () => clearInterval(id);
  }, [active, router]);

  if (!active) return null;

  return (
    // `role=status` so the polling that grows the trace is announced at all;
    // the dot is `live-dot` (the app's one pulse idiom, a ring rather than a
    // fade) and `bg-accent`, not the `bg-accent-solid` it used to carry —
    // that token doesn't exist in the theme, so Tailwind emitted no rule and
    // the dot rendered as an invisible 6px box.
    <span
      role="status"
      aria-live="polite"
      className="text-subtle inline-flex items-center gap-1.5 text-xs"
    >
      <span className="live-dot bg-accent h-1.5 w-1.5 rounded-full" />
      live
    </span>
  );
}

"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * The page showing a queued/in-flight run is a server component, so the only
 * way its trace grows is to re-fetch it. Polling stops once the run reaches
 * a terminal status, so a finished run costs nothing.
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
    // `role=status` announces the polling. Dot uses `live-dot` (the app's
    // pulse idiom, a ring not a fade) and `bg-accent` — not `bg-accent-solid`,
    // which isn't a real theme token and rendered as an invisible 6px box.
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

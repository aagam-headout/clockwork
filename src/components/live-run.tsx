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
    <span className="text-subtle inline-flex items-center gap-1.5 text-xs">
      <span className="bg-accent-solid h-1.5 w-1.5 animate-pulse rounded-full" />
      live
    </span>
  );
}

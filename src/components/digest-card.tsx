"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { ChevronRight, Expand, X } from "lucide-react";

/**
 * A digest is a full workflow output, often much longer than the card or
 * section it lands in should show inline. Collapsed by default to a short
 * clamp; "Expand" opens the whole thing in a near-fullscreen dialog instead
 * of growing in place, so reading a long one doesn't cost the reader their
 * scroll position on the feed or run page behind it.
 *
 * Used both on the overview feed (one per workflow, with a link back to the
 * run) and on a run's own detail page (no link needed — it's already there).
 *
 * `rendered` is the markdown already turned into JSX by the server — `<Markdown>`
 * is a server component, so it's rendered once by the parent and handed down
 * as children rather than re-rendered here.
 */
export function DigestCard({
  title,
  createdAt,
  meta,
  viewRunHref,
  rendered,
}: {
  title: string;
  createdAt?: Date;
  /** Extra info after the timestamp — delivery targets, etc. */
  meta?: React.ReactNode;
  viewRunHref?: string;
  rendered: React.ReactNode;
}) {
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    if (!expanded) return;
    const onKey = (e: KeyboardEvent) =>
      e.key === "Escape" && setExpanded(false);
    window.addEventListener("keydown", onKey);
    // Body scroll fights the dialog's own scroll otherwise — a long digest
    // behind a short one would scroll the page instead of the panel.
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [expanded]);

  const timestamp = createdAt && (
    <span>
      {createdAt.toLocaleDateString("en-US", {
        weekday: "long",
        month: "long",
        day: "numeric",
      })}{" "}
      · {createdAt.toLocaleTimeString("en-US", { timeStyle: "short" })}
    </span>
  );

  return (
    <>
      {/* `max-h-56` clamps to roughly a paragraph and a half; the fade tells the
          eye there's more without a hard-edged cutoff. */}
      <div className="relative">
        <div
          className={`px-4 py-4 ${expanded ? "" : "max-h-56 overflow-hidden"}`}
        >
          {rendered}
        </div>
        {!expanded && (
          <div className="from-surface pointer-events-none absolute inset-x-0 bottom-0 h-12 bg-gradient-to-t to-transparent" />
        )}
      </div>

      <button
        type="button"
        onClick={() => setExpanded(true)}
        className="border-border text-muted hover:bg-surface-hover hover:text-foreground flex w-full cursor-pointer items-center justify-center gap-1.5 border-t px-4 py-2 text-[12.5px] font-medium transition-colors"
      >
        <Expand className="h-3.5 w-3.5" />
        Expand digest
      </button>

      {expanded &&
        typeof document !== "undefined" &&
        createPortal(
          <div className="fixed inset-0 z-50 flex items-stretch justify-center p-3 sm:p-6">
            <button
              type="button"
              aria-label="Close digest"
              onClick={() => setExpanded(false)}
              className="bg-bg/60 absolute inset-0 backdrop-blur-[2px]"
            />

            <div
              role="dialog"
              aria-modal="true"
              aria-label={`${title} digest`}
              className="rise rounded-container border-border bg-surface shadow-pop relative flex w-full max-w-4xl flex-col overflow-hidden border"
            >
              <div className="border-border bg-bg-subtle flex shrink-0 items-start justify-between gap-3 border-b px-5 py-4">
                <div className="min-w-0">
                  <h2 className="heading-16 text-foreground truncate">
                    {title}
                  </h2>
                  {(timestamp || meta) && (
                    <div className="text-subtle mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12.5px]">
                      {timestamp}
                      {timestamp && meta && <span aria-hidden>·</span>}
                      {meta}
                    </div>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {viewRunHref && (
                    <Link
                      href={viewRunHref}
                      className="text-muted hover:text-foreground inline-flex items-center gap-1 text-[12.5px] font-medium whitespace-nowrap"
                    >
                      View run
                      <ChevronRight className="h-3.5 w-3.5" />
                    </Link>
                  )}
                  <button
                    type="button"
                    onClick={() => setExpanded(false)}
                    aria-label="Close"
                    className="rounded-control border-border text-muted hover:border-border-strong hover:bg-surface-hover hover:text-foreground flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center border transition-colors"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              </div>

              <div className="flex-1 overflow-y-auto px-5 py-5">{rendered}</div>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}

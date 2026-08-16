"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { ChevronRight, Expand, X } from "lucide-react";
import { LocalTime } from "@/components/local-time";

/**
 * A digest is a full workflow output, often too long for the card or section
 * it lands in. Both surfaces open it in a near-fullscreen dialog instead of
 * growing in place, so reading a long one doesn't cost the reader their
 * scroll position on the page behind it.
 *
 * Two shapes, one dialog:
 * - `DigestCard` — clamped preview plus expand affordance. Used on a run's
 *   own page, where the digest is the thing you came for.
 * - `DigestRow` — one line per digest, click to open. Used on the overview
 *   feed, for scanning what ran today rather than reading each one.
 *
 * `rendered` is markdown already turned into JSX by the server (`<Markdown>`
 * is a server component), rendered once by the parent and handed down.
 */
type DigestProps = {
  title: string;
  createdAt?: Date;
  /** Extra info after the timestamp — delivery targets, etc. */
  meta?: React.ReactNode;
  viewRunHref?: string;
  rendered: React.ReactNode;
};

export function DigestCard({
  title,
  createdAt,
  meta,
  viewRunHref,
  rendered,
}: DigestProps) {
  const [open, setOpen] = useState(false);

  return (
    <>
      {/* `max-h-56` clamps to ~a paragraph and a half; the fade signals more
          without a hard cutoff. */}
      <div className="relative">
        <div className="max-h-56 overflow-hidden px-4 py-4">{rendered}</div>
        <div className="from-surface pointer-events-none absolute inset-x-0 bottom-0 h-12 bg-gradient-to-t to-transparent" />
      </div>

      <button
        type="button"
        onClick={() => setOpen(true)}
        className="border-border text-muted hover:bg-surface-hover hover:text-foreground flex w-full cursor-pointer items-center justify-center gap-1.5 border-t px-4 py-2 text-[12.5px] font-medium transition-colors"
      >
        <Expand className="h-3.5 w-3.5" />
        Expand digest
      </button>

      <DigestDialog
        open={open}
        onClose={() => setOpen(false)}
        title={title}
        createdAt={createdAt}
        meta={meta}
        viewRunHref={viewRunHref}
        rendered={rendered}
      />
    </>
  );
}

/**
 * One digest as a single row: what ran, where it went, when. The whole row is
 * the trigger — body lives in the dialog, so a dozen digests stay one
 * scannable list instead of a dozen clamped cards.
 *
 * The row is a `<button>`, so it holds no nested links; "View run" lives in
 * the dialog header instead, where the decision to open it actually happens.
 */
export function DigestRow({
  title,
  createdAt,
  meta,
  preview,
  badge,
  viewRunHref,
  rendered,
}: DigestProps & {
  /** First line or so of the digest, in plain text — the row's teaser. */
  preview?: string;
  /** Short trailing label — delivery targets, shown inline on wide rows. */
  badge?: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        className="border-border hover:bg-surface-hover group flex w-full cursor-pointer items-center gap-3 border-b px-4 py-3 text-left transition-colors last:border-b-0"
      >
        <span className="text-foreground min-w-0 shrink-0 truncate text-[13px] font-medium">
          {title}
        </span>

        {/* The one-line teaser makes the row worth scanning — without it every
            row is just a workflow name. First to give up width; gone on phone. */}
        {preview && (
          <span className="text-muted hidden min-w-0 flex-1 truncate text-[12.5px] sm:block">
            {preview}
          </span>
        )}
        {/* Pushes time and chevron right when the teaser isn't rendered —
            below `sm`, or when there's nothing to preview. */}
        <span className={preview ? "flex-1 sm:hidden" : "flex-1"} />

        {badge && <span className="hidden shrink-0 md:block">{badge}</span>}

        {createdAt && (
          <LocalTime
            value={createdAt}
            format="time"
            className="text-subtle shrink-0 font-mono text-[11px]"
          />
        )}

        <ChevronRight className="text-subtle h-4 w-4 shrink-0 transition-transform group-hover:translate-x-0.5" />
      </button>

      <DigestDialog
        open={open}
        onClose={() => setOpen(false)}
        title={title}
        createdAt={createdAt}
        meta={meta}
        viewRunHref={viewRunHref}
        rendered={rendered}
      />
    </>
  );
}

function DigestDialog({
  open,
  onClose,
  title,
  createdAt,
  meta,
  viewRunHref,
  rendered,
}: DigestProps & { open: boolean; onClose: () => void }) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    // Focus the panel on open, or the ring stays on the row behind it and
    // Page Down scrolls the page under the overlay instead of the dialog.
    panelRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    // Otherwise body scroll fights the dialog's — a long digest behind a
    // short one would scroll the page instead of the panel.
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open, onClose]);

  if (!open || typeof document === "undefined") return null;

  const timestamp = createdAt && <LocalTime value={createdAt} format="long" />;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-stretch justify-center p-3 sm:p-6">
      <button
        type="button"
        aria-label="Close digest"
        onClick={onClose}
        className="bg-bg/60 absolute inset-0 backdrop-blur-[2px]"
      />

      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={`${title} digest`}
        tabIndex={-1}
        className="rise rounded-container border-border bg-surface shadow-pop relative flex w-full max-w-4xl flex-col overflow-hidden border outline-none"
      >
        <div className="border-border bg-bg-subtle flex shrink-0 items-start justify-between gap-3 border-b px-5 py-4">
          <div className="min-w-0">
            <h2 className="heading-16 text-foreground truncate">{title}</h2>
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
              onClick={onClose}
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
  );
}

"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { Eye, PenLine } from "lucide-react";
import { Markdown } from "@/components/markdown";

/**
 * Grows a textarea to fit its content, up to `max` pixels, then scrolls.
 * Shared by the goal editor and the builder's composer, since a fixed `rows`
 * is either too tall for one line or too short for ten.
 *
 * Layout effect, not effect: height applies before paint, so a form seeded
 * with a long saved value never flashes at its collapsed height.
 */
export function useAutosize(
  value: string,
  max: number,
): React.RefObject<HTMLTextAreaElement | null> {
  const ref = useRef<HTMLTextAreaElement>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    // Reset first: `scrollHeight` never shrinks below current height, so
    // deleting text would otherwise leave the box at its high-water mark.
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, max)}px`;
    el.style.overflowY = el.scrollHeight > max ? "auto" : "hidden";
  }, [value, max]);

  return ref;
}

/**
 * The goal field: a markdown source box with a preview.
 *
 * A workflow's goal is a prompt written with headings, lists and fenced
 * examples, but a textarea shows all that as source while the digest it
 * produces is rendered. Preview closes that gap with the exact `<Markdown>`
 * the run page and Slack path use, so what you check here matches everywhere else.
 *
 * The textarea is never unmounted — preview hides, not replaces it. A field
 * that leaves the DOM leaves `FormData` with it, so the goal would submit
 * empty for anyone who pressed Preview before Save.
 */
export function MarkdownEditor({
  name,
  value,
  onChange,
  placeholder,
  minHeight = 140,
  maxHeight = 420,
  meta,
}: {
  name: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  minHeight?: number;
  maxHeight?: number;
  /** Trailing note on the toolbar — a token count, a limit. */
  meta?: React.ReactNode;
}) {
  const [preview, setPreview] = useState(false);
  const ref = useAutosize(value, maxHeight);

  return (
    <div className="rounded-control border-border bg-bg focus-within:border-border-strong overflow-hidden border transition-colors">
      <div className="border-border bg-bg-subtle flex items-center gap-1 border-b px-1.5 py-1">
        <Tab active={!preview} onClick={() => setPreview(false)} icon={PenLine}>
          Write
        </Tab>
        <Tab active={preview} onClick={() => setPreview(true)} icon={Eye}>
          Preview
        </Tab>
        <span className="flex-1" />
        {meta && (
          <span className="text-subtle shrink-0 text-[11px] tabular-nums">
            {meta}
          </span>
        )}
      </div>

      {/* `relative` anchors the clipped textarea in preview — `sr-only`
          positions it absolutely, and outside this box it'd scroll the page
          on focus. */}
      <div className="relative px-3 py-2.5" style={{ minHeight }}>
        <textarea
          ref={ref}
          name={name}
          required
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          // Back to Write if rejected — an invisible `required` field is a
          // submit that appears to do nothing.
          onInvalid={() => setPreview(false)}
          aria-hidden={preview}
          style={preview ? undefined : { minHeight: minHeight - 20 }}
          /*
           * `sr-only`, not `hidden`, in preview: `display:none` isn't
           * focusable, and Chrome skips constraint validation on it — an
           * empty goal would block Save with only a console message. Clipped
           * stays validatable, and `onInvalid` above brings it back on screen
           * before the browser's bubble points at it.
           */
          className={`text-foreground placeholder:text-subtle w-full resize-none bg-transparent font-mono text-[13px] leading-relaxed outline-none ${
            preview ? "sr-only" : "block"
          }`}
        />

        {preview &&
          (value.trim() ? (
            <Markdown size="sm">{value}</Markdown>
          ) : (
            <p className="text-subtle text-[13px]">Nothing to preview yet.</p>
          ))}
      </div>
    </div>
  );
}

function Tab({
  active,
  onClick,
  icon: Icon,
  children,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ComponentType<{ className?: string }>;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`inline-flex h-6 cursor-pointer items-center gap-1.5 rounded-[5px] px-2 text-[11px] font-medium transition-colors ${
        active
          ? "bg-surface-2 text-foreground"
          : "text-subtle hover:text-foreground"
      }`}
    >
      <Icon className="h-3 w-3" />
      {children}
    </button>
  );
}

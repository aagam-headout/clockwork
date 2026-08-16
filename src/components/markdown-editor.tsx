"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { Eye, PenLine } from "lucide-react";
import { Markdown } from "@/components/markdown";

/**
 * Grows a textarea to fit what's in it, up to `max` pixels, then lets it
 * scroll. Shared by the goal editor and the builder's composer: both are boxes
 * you write prose into, and a fixed `rows` is either too tall for one line or
 * too short for ten.
 *
 * Layout effect, not effect: the height is applied before paint, so a form
 * seeded with a long saved value never flashes at its collapsed height.
 */
export function useAutosize(
  value: string,
  max: number,
): React.RefObject<HTMLTextAreaElement | null> {
  const ref = useRef<HTMLTextAreaElement>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    // Reset first: `scrollHeight` never shrinks below the current height, so
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
 * A workflow's goal is a prompt, and prompts get written with headings, lists
 * and fenced examples — but a textarea shows all of that as source, and the
 * digest it produces is rendered. Preview closes that gap with the exact
 * `<Markdown>` the run page and Slack path use, so what you check here is what
 * the model's instructions will look like everywhere else.
 *
 * The textarea is never unmounted — preview hides it rather than replacing it.
 * A form field that leaves the DOM leaves the `FormData` with it, and the goal
 * would submit empty for anyone who pressed Preview before Save.
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

      {/* `relative` so the clipped textarea stays anchored here in preview —
          an `sr-only` field is absolutely positioned, and one that lands
          outside its own box scrolls the page when it takes focus. */}
      <div className="relative px-3 py-2.5" style={{ minHeight }}>
        <textarea
          ref={ref}
          name={name}
          required
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          // Back to Write if the browser rejects it. A `required` field the
          // user can't see is a submit that appears to do nothing.
          onInvalid={() => setPreview(false)}
          aria-hidden={preview}
          style={preview ? undefined : { minHeight: minHeight - 20 }}
          /*
           * `sr-only` in preview, not `hidden`: a `display:none` field is not
           * focusable, and Chrome refuses to run constraint validation on one —
           * an empty goal would block Save with only a console message. Clipped
           * keeps it validatable, and `onInvalid` above brings it back on
           * screen before the browser points its bubble at it.
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

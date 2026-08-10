import Link from "next/link";
import { ArrowLeft } from "lucide-react";

/*
 * Shared presentational primitives, in the Geist idiom: flat surfaces defined
 * by 1px borders, a black/white primary action, 6px control radius and 12px
 * container radius. Server-safe (no hooks, no "use client") so pages compose
 * them directly; the interactive variants live alongside in submit-button.tsx
 * and theme-toggle.tsx.
 */

type Tone = "neutral" | "accent" | "success" | "danger" | "warn";

/*
 * The soft wash colours sit close to the page background, so a border painted
 * in the same hue disappears entirely — a status chip or an alert needs the
 * `-line` tokens for an edge that actually reads against `bg`/`surface`.
 */
const TONE_SOFT: Record<Tone, string> = {
  neutral: "bg-surface-2 text-muted border-border",
  accent: "bg-accent-soft text-accent-text border-accent-line",
  success: "bg-success-soft text-success-text border-success-line",
  danger: "bg-danger-soft text-danger-text border-danger-line",
  warn: "bg-warn-soft text-warn-text border-warn-line",
};

const TONE_DOT: Record<Tone, string> = {
  neutral: "bg-subtle",
  accent: "bg-accent",
  success: "bg-success",
  danger: "bg-danger",
  warn: "bg-warn",
};

export function Badge({
  children,
  tone = "neutral",
  dot = false,
  mono = false,
  icon: Icon,
  className = "",
}: {
  children: React.ReactNode;
  tone?: Tone;
  dot?: boolean;
  mono?: boolean;
  /** Leading glyph, sized and spaced by the chip rather than by the caller. */
  icon?: React.ComponentType<{ className?: string }>;
  className?: string;
}) {
  return (
    // 22px tall, not 20: at 20 an 11px cap-height sits visually high against
    // the 32px controls it shares a row with.
    <span
      className={`rounded-chip inline-flex h-[22px] shrink-0 items-center gap-1.5 border px-2 text-[11px] leading-none font-medium ${
        TONE_SOFT[tone]
      } ${mono ? "font-mono tracking-tight" : ""} ${className}`}
    >
      {dot && <span className={`h-1.5 w-1.5 rounded-full ${TONE_DOT[tone]}`} />}
      {Icon && <Icon className="h-3 w-3 shrink-0 opacity-70" />}
      {children}
    </span>
  );
}

export function StatusDot({
  tone,
  live = false,
}: {
  tone: Tone;
  live?: boolean;
}) {
  return (
    <span
      className={`h-2 w-2 shrink-0 rounded-full ${TONE_DOT[tone]} ${live ? "live-dot" : ""}`}
    />
  );
}

/** Maps a run status onto a tone once, so every surface agrees. */
export function statusTone(status: string): Tone {
  if (status === "ok") return "success";
  if (status === "error") return "danger";
  if (status === "truncated") return "warn";
  if (status === "running" || status === "queued") return "accent";
  return "neutral";
}

export function Card({
  children,
  interactive = false,
  className = "",
  as: As = "div",
}: {
  children: React.ReactNode;
  interactive?: boolean;
  className?: string;
  as?: "div" | "article" | "section" | "li";
}) {
  return (
    <As
      className={`rounded-container border-border bg-surface border ${
        interactive
          ? "hover:border-border-strong transition-[border-color,background] duration-150"
          : ""
      } ${className}`}
    >
      {children}
    </As>
  );
}

const BUTTON_BASE =
  "inline-flex shrink-0 cursor-pointer items-center justify-center gap-1.5 rounded-control font-medium transition-[background,color,border-color,opacity] duration-150 disabled:cursor-not-allowed disabled:opacity-45";

// Geist control heights: 32 / 40 / 48. Text stays 14px at every size.
export const BUTTON_SIZES = {
  sm: "h-8 px-3 text-[13px]",
  md: "h-10 px-4 text-sm",
  lg: "h-12 px-5 text-sm",
} as const;

/*
 * Icon-only buttons are their own size, not a text size with the padding
 * cancelled. Appending `px-0` to `buttonClass(…, "sm")` looks like it works and
 * doesn't: `px-0` and `px-3` have equal specificity, so the winner is whichever
 * Tailwind emits last — and it emits `px-3` last. The padding survived, the
 * 32px box had ~6px of content left, and the 16px glyph inside got squeezed to
 * 6–8px wide. These strings carry no horizontal padding to begin with.
 */
export const ICON_BUTTON_SIZES = {
  xs: "h-6 w-6",
  sm: "h-8 w-8",
  md: "h-10 w-10",
  lg: "h-12 w-12",
} as const;

export function iconButtonClass(
  variant: keyof typeof BUTTON_VARIANTS = "outline",
  size: keyof typeof ICON_BUTTON_SIZES = "sm",
  className = "",
) {
  return `${BUTTON_BASE} ${BUTTON_VARIANTS[variant]} ${ICON_BUTTON_SIZES[size]} ${className}`;
}

export const BUTTON_VARIANTS = {
  /* The primary action is the inverted one — black on white, white on black. */
  primary: "bg-solid text-solid-fg hover:bg-solid-hover",
  solid: "bg-solid text-solid-fg hover:bg-solid-hover",
  outline:
    "border border-border bg-bg text-foreground hover:border-border-strong hover:bg-surface-hover",
  ghost: "text-muted hover:bg-surface-hover hover:text-foreground",
  danger:
    "border border-border bg-bg text-danger-text hover:border-danger-line hover:bg-danger-soft",
} as const;

export function buttonClass(
  variant: keyof typeof BUTTON_VARIANTS = "outline",
  size: keyof typeof BUTTON_SIZES = "md",
  className = "",
) {
  return `${BUTTON_BASE} ${BUTTON_VARIANTS[variant]} ${BUTTON_SIZES[size]} ${className}`;
}

export function ButtonLink({
  href,
  children,
  variant = "outline",
  size = "md",
  icon: Icon,
  className = "",
}: {
  href: string;
  children: React.ReactNode;
  variant?: keyof typeof BUTTON_VARIANTS;
  size?: keyof typeof BUTTON_SIZES;
  icon?: React.ComponentType<{ className?: string }>;
  className?: string;
}) {
  return (
    <Link href={href} className={buttonClass(variant, size, className)}>
      {/* The small control is 32px tall with 13px text; a 16px glyph next to it
          reads as oversized, so the icon tracks the button's size. */}
      {Icon && <Icon className={size === "sm" ? "h-3.5 w-3.5" : "h-4 w-4"} />}
      {children}
    </Link>
  );
}

/**
 * The one content shell every page uses — same max width, same gutters, same
 * top offset, so switching tabs doesn't shift the header or the left edge.
 * `fill` is for screens that own the viewport instead of scrolling as a
 * document (the workflow builder): the shell becomes a full-height flex column
 * whose children manage their own scrolling.
 */
export function PageShell({
  children,
  fill = false,
}: {
  children: React.ReactNode;
  fill?: boolean;
}) {
  return (
    // Gutters step up with the viewport (20 → 32 → 48 → 64px). The rail already
    // eats the left edge, so content needs real air on both sides of it rather
    // than the flat 16px it had.
    <main
      className={`mx-auto flex w-full max-w-7xl flex-col px-5 py-6 md:px-8 lg:px-12 xl:px-16 ${
        // The fill variant keeps the same top offset so page titles line up
        // across tabs, but a tighter bottom so the panes get the height.
        fill
          ? "lg:h-screen lg:overflow-hidden lg:pt-10 lg:pb-6"
          : "md:py-8 lg:py-10"
      }`}
    >
      {children}
    </main>
  );
}

export function PageHeader({
  title,
  subtitle,
  backHref,
  backLabel,
  actions,
  children,
}: {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  backHref?: string;
  backLabel?: string;
  actions?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <header className="rise">
      {backHref && (
        <Link
          href={backHref}
          className="text-muted hover:text-foreground mb-3 inline-flex items-center gap-1 text-[13px] transition-colors"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          {backLabel ?? "Back"}
        </Link>
      )}
      {/* `items-start`, not `items-center`: a two-line subtitle used to drag
          the action buttons down to the block's midpoint. They now stay on the
          title's line, which is where the eye looks for them. */}
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
        <div className="min-w-0 flex-1">
          <h1 className="heading-24 text-foreground truncate">{title}</h1>
          {subtitle && (
            <div className="text-muted mt-1.5 text-sm leading-relaxed">
              {subtitle}
            </div>
          )}
        </div>
        {actions && (
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            {actions}
          </div>
        )}
      </div>
      {children}
    </header>
  );
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  description?: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="rise rounded-container border-border bg-bg-subtle flex flex-col items-center border px-6 py-16 text-center">
      <div className="rounded-control border-border bg-surface flex h-10 w-10 items-center justify-center border">
        <Icon className="text-subtle h-4.5 w-4.5" />
      </div>
      <p className="heading-16 text-foreground mt-4">{title}</p>
      {description && (
        <p className="text-muted mt-1.5 max-w-sm text-sm">{description}</p>
      )}
      {action && <div className="mt-6">{action}</div>}
    </div>
  );
}

export function Stat({
  label,
  value,
  hint,
  tone = "neutral",
  icon: Icon,
}: {
  label: string;
  value: React.ReactNode;
  hint?: string;
  tone?: Tone;
  icon?: React.ComponentType<{ className?: string }>;
}) {
  return (
    // Tiles in a row rarely all carry a hint; `justify-between` on a flex
    // column with a fixed floor keeps their numbers on one baseline instead of
    // letting each tile shrink to its own content.
    <div className="rounded-container border-border bg-surface flex min-h-[92px] flex-col justify-between border px-4 py-3.5">
      <div className="flex items-center gap-1.5">
        {Icon ? (
          <Icon className="text-subtle h-3.5 w-3.5 shrink-0" />
        ) : (
          <span className={`h-1.5 w-1.5 rounded-full ${TONE_DOT[tone]}`} />
        )}
        <span className="text-muted truncate text-xs font-medium">{label}</span>
      </div>
      <div className="text-foreground mt-2 text-[26px] leading-none font-semibold tracking-[-1.04px] tabular-nums">
        {value}
      </div>
      <div className="text-subtle mt-2 h-4 truncate text-xs">{hint}</div>
    </div>
  );
}

export function SectionLabel({
  children,
  count,
  action,
  icon: Icon,
  headingClassName = "heading-14",
}: {
  children: React.ReactNode;
  count?: number;
  action?: React.ReactNode;
  icon?: React.ComponentType<{ className?: string }>;
  headingClassName?: string;
}) {
  return (
    // The row is 32px tall whether or not it carries an action, so a section
    // with a trailing button doesn't sit lower than the ones without.
    <div className="mb-3 flex min-h-8 items-center gap-2">
      {Icon && <Icon className="text-subtle h-4 w-4 shrink-0" />}
      <h2 className={`${headingClassName} text-foreground`}>{children}</h2>
      {count != null && (
        <span className="border-border bg-surface-2 text-muted rounded-chip min-w-5 border px-1.5 text-center text-[11px] leading-[18px] font-medium tabular-nums">
          {count}
        </span>
      )}
      <div className="flex-1" />
      {action}
    </div>
  );
}

export function Mono({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    // Same 22px box as Badge: these two sit side by side in every header and
    // card row, and `py-0.5` on an inline <code> made them disagree by 2px.
    <code
      className={`rounded-chip border-border bg-surface-2 text-muted inline-flex h-[22px] shrink-0 items-center border px-1.5 font-mono text-[11px] leading-none tracking-tight ${className}`}
    >
      {children}
    </code>
  );
}

export function Alert({
  tone = "danger",
  title,
  children,
}: {
  tone?: Tone;
  title?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={`rounded-container border px-4 py-3 text-sm ${TONE_SOFT[tone]}`}
    >
      {title && <p className="font-medium">{title}</p>}
      <div className={title ? "mt-1 opacity-90" : ""}>{children}</div>
    </div>
  );
}

/** Loading placeholder — matched to the row/card geometry it stands in for. */
export function Skeleton({ className = "" }: { className?: string }) {
  return <span className={`skeleton block ${className}`} aria-hidden />;
}

/**
 * The list container every table-ish surface in the app shares: one bordered
 * box, hairline dividers, no inner shadows.
 */
export function ListBox({
  children,
  className = "",
  as: As = "div",
  id,
}: {
  children: React.ReactNode;
  className?: string;
  /** `ol`/`ul` when the rows are a real list (the run trace). */
  as?: "div" | "ol" | "ul";
  /** Anchor for controls that act on the rows (trace expand-all). */
  id?: string;
}) {
  return (
    <As
      id={id}
      className={`divide-border rounded-container border-border bg-surface divide-y overflow-hidden border ${className}`}
    >
      {children}
    </As>
  );
}

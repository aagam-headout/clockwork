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

// Geist badges are outlined, not filled blocks — a soft wash plus a real
// 1px border in the same hue.
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
  className = "",
}: {
  children: React.ReactNode;
  tone?: Tone;
  dot?: boolean;
  mono?: boolean;
  className?: string;
}) {
  return (
    <span
      className={`inline-flex h-5 shrink-0 items-center gap-1.5 rounded-full border px-2 text-[11px] font-medium leading-none ${
        TONE_SOFT[tone]
      } ${mono ? "font-mono tracking-tight" : ""} ${className}`}
    >
      {dot && <span className={`h-1.5 w-1.5 rounded-full ${TONE_DOT[tone]}`} />}
      {children}
    </span>
  );
}

export function StatusDot({ tone, live = false }: { tone: Tone; live?: boolean }) {
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
  if (status === "running") return "accent";
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
      className={`rounded-container border border-border bg-surface ${
        interactive
          ? "transition-[border-color,background] duration-150 hover:border-border-strong"
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
  className = ""
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
      {Icon && <Icon className="h-4 w-4" />}
      {children}
    </Link>
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
          className="mb-3 inline-flex items-center gap-1 text-[13px] text-muted transition-colors hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          {backLabel ?? "Back"}
        </Link>
      )}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="min-w-0">
          <h1 className="heading-24 truncate text-foreground">{title}</h1>
          {subtitle && <div className="mt-1 text-sm text-muted">{subtitle}</div>}
        </div>
        {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
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
    <div className="rise flex flex-col items-center rounded-container border border-border bg-bg-subtle px-6 py-16 text-center">
      <div className="flex h-10 w-10 items-center justify-center rounded-control border border-border bg-surface">
        <Icon className="h-4.5 w-4.5 text-subtle" />
      </div>
      <p className="heading-16 mt-4 text-foreground">{title}</p>
      {description && <p className="mt-1.5 max-w-sm text-sm text-muted">{description}</p>}
      {action && <div className="mt-6">{action}</div>}
    </div>
  );
}

export function Stat({
  label,
  value,
  hint,
  tone = "neutral",
}: {
  label: string;
  value: React.ReactNode;
  hint?: string;
  tone?: Tone;
}) {
  return (
    <div className="rounded-container border border-border bg-surface px-4 py-3.5">
      <div className="flex items-center gap-1.5">
        <span className={`h-1.5 w-1.5 rounded-full ${TONE_DOT[tone]}`} />
        <span className="text-xs font-medium text-muted">{label}</span>
      </div>
      <div className="mt-2 text-[28px] font-semibold leading-none tracking-[-1.12px] tabular-nums text-foreground">
        {value}
      </div>
      {hint && <div className="mt-2 truncate text-xs text-subtle">{hint}</div>}
    </div>
  );
}

export function SectionLabel({
  children,
  count,
  action,
}: {
  children: React.ReactNode;
  count?: number;
  action?: React.ReactNode;
}) {
  return (
    <div className="mb-3 flex items-center gap-2">
      <h2 className="heading-14 text-foreground">{children}</h2>
      {count != null && (
        <span className="rounded-full border border-border bg-surface-2 px-1.5 text-[11px] font-medium leading-5 tabular-nums text-muted">
          {count}
        </span>
      )}
      <div className="flex-1" />
      {action}
    </div>
  );
}

export function Mono({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <code
      className={`rounded-control border border-border bg-surface-2 px-1.5 py-0.5 font-mono text-[11px] tracking-tight text-muted ${className}`}
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
    <div className={`rounded-container border px-4 py-3 text-sm ${TONE_SOFT[tone]}`}>
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
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`divide-y divide-border overflow-hidden rounded-container border border-border bg-surface ${className}`}
    >
      {children}
    </div>
  );
}

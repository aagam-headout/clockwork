import { TOOLKIT_ICONS } from "@/lib/toolkit-labels";
import { Puzzle } from "lucide-react";

/**
 * Toolkit avatar. Composio ships a logo URL for most toolkits; since the
 * catalog is open-ended we can't bundle an icon per app, so the logo is used
 * when present and a lucide glyph (or initial) stands in otherwise. Plain
 * <img> on purpose — remote hosts vary, and next/image would need every one
 * allow-listed in next.config.
 */
export function ToolkitLogo({
  slug,
  name,
  logo,
  size = "md",
  connected = false,
  connectedTone = "neutral",
  className = "",
}: {
  slug: string;
  name: string;
  logo?: string;
  size?: "md" | "lg";
  connected?: boolean;
  /** "neutral" just emphasizes the box (/connections already shows a status
   *  badge alongside it); "accent" is the catalog's "shown here" tint
   *  (connector browser) and carries no account-status meaning. */
  connectedTone?: "accent" | "neutral";
  className?: string;
}) {
  const box = size === "lg" ? "h-9 w-9" : "h-8 w-8";
  const glyph = size === "lg" ? "h-4.5 w-4.5" : "h-4 w-4";
  const Fallback = TOOLKIT_ICONS[slug] ?? Puzzle;

  return (
    <span
      title={name}
      className={`rounded-control flex ${box} shrink-0 items-center justify-center overflow-hidden border ${
        connected
          ? connectedTone === "accent"
            ? // Bare `accent` is special-cased in globals.css to a neutral
              // hover-gray in dark mode (better-auth-ui compat), so
              // `border-accent/25` loses its color there — `-line` isn't
              // touched by that override and stays blue in both themes.
              "border-accent-line bg-accent-soft text-accent-text"
            : "border-border-strong bg-surface-2 text-foreground"
          : "border-border bg-surface-2 text-subtle"
      } ${className}`}
    >
      {logo ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={logo} alt="" className="h-full w-full object-contain p-1.5" />
      ) : (
        <Fallback className={glyph} />
      )}
    </span>
  );
}

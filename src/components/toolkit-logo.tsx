import { TOOLKIT_ICONS } from "@/lib/toolkit-labels";
import { Puzzle } from "lucide-react";

/**
 * Toolkit avatar. Composio ships a logo URL for most toolkits; since the
 * catalog is open-ended we can't bundle an icon per app, so the logo is used
 * when present and a lucide glyph (or the initial) stands in when it isn't.
 * Plain <img> on purpose — remote hosts vary, and next/image would need every
 * one allow-listed in next.config.
 */
export function ToolkitLogo({
  slug,
  name,
  logo,
  size = "md",
  connected = false,
}: {
  slug: string;
  name: string;
  logo?: string;
  size?: "md" | "lg";
  connected?: boolean;
}) {
  const box = size === "lg" ? "h-9 w-9" : "h-8 w-8";
  const glyph = size === "lg" ? "h-4.5 w-4.5" : "h-4 w-4";
  const Fallback = TOOLKIT_ICONS[slug] ?? Puzzle;

  return (
    <span
      title={name}
      className={`flex ${box} shrink-0 items-center justify-center overflow-hidden rounded-lg border ${
        connected
          ? "border-success/25 bg-success-soft text-success-text"
          : "border-border bg-surface-2 text-subtle"
      }`}
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

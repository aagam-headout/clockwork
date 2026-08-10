// The app's own mark, so nothing here depends on a generic lucide glyph: three
// flowing ripple waves, fading as they travel. Kept in sync with app/icon.svg,
// which is the same geometry with baked-in colors for the favicon.
// `LogoGlyph` inherits currentColor; `Logo` is the badge + glyph used in chrome.

// One wave: 15.6 wide, peaks ±2.4 around its baseline. Rows sit at 6/12/18 and
// start at x 4.2, which centers the set of three in the 24 box both ways.
const WAVE = "c2.6-3.2 5.2-3.2 7.8 0s5.2 3.2 7.8 0";

export function LogoGlyph({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
    >
      <path d={`M4.2 6${WAVE}`} />
      <path d={`M4.2 12${WAVE}`} opacity="0.8" />
      <path d={`M4.2 18${WAVE}`} opacity="0.62" />
    </svg>
  );
}

const BADGE_SIZES = {
  sm: "h-6.5 w-6.5 rounded-control",
  md: "h-10 w-10 rounded-container",
} as const;

// Light-grey frosted glass; `.logo-badge` (globals.css) carries the tint, blur
// and inner highlight so both themes get the same treatment.
const BADGE_BASE = "logo-badge flex items-center justify-center text-foreground";

const GLYPH_SIZES = {
  sm: "h-4 w-4",
  md: "h-5.5 w-5.5",
} as const;

export function Logo({
  size = "sm",
  className = "",
}: {
  size?: keyof typeof BADGE_SIZES;
  className?: string;
}) {
  return (
    <span
      className={`${BADGE_BASE} ${BADGE_SIZES[size]} ${className}`}
    >
      <LogoGlyph className={GLYPH_SIZES[size]} />
    </span>
  );
}

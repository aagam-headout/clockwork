// The app's own mark, so nothing here depends on a generic lucide glyph: a clock
// whose dial is broken into three segments — the steps of a run — closing into an
// arrowhead, so it reads as time plus flow. Kept in sync with app/icon.svg, which
// is the same geometry with baked-in colors for the favicon.
// `LogoGlyph` inherits currentColor; `Logo` is the badge + glyph used in chrome.

// Dial: r 7.6 around (12,12), three 100° arcs separated by 20° gaps, drawn
// clockwise. Endpoints are precomputed so the arcs stay exact at any size.
const SEGMENTS = [
  "M13.32 4.52A7.6 7.6 0 0 1 19.14 14.6",
  "M17.82 16.89A7.6 7.6 0 0 1 6.18 16.89",
  "M4.86 14.6A7.6 7.6 0 0 1 10.68 4.52",
];
// Arrowhead on the last segment's end, along its tangent — gives the cycle a
// direction and lands in the top gap.
const ARROW = "M8.2 7.3 10.68 4.52 7.5 2.7";
// Hands: 12 o'clock down to centre, then out to ~4 o'clock.
const HANDS = "M12 8.2V12l3 1.7";

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
      strokeLinejoin="round"
    >
      {SEGMENTS.map((d) => (
        <path key={d} d={d} />
      ))}
      <path d={ARROW} />
      <path d={HANDS} />
    </svg>
  );
}

const BADGE_SIZES = {
  sm: "h-6.5 w-6.5 rounded-control",
  md: "h-10 w-10 rounded-container",
} as const;

// Light-grey frosted glass; `.logo-badge` (globals.css) carries the tint, blur
// and inner highlight so both themes get the same treatment.
const BADGE_BASE =
  "logo-badge flex items-center justify-center text-foreground";

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
    <span className={`${BADGE_BASE} ${BADGE_SIZES[size]} ${className}`}>
      <LogoGlyph className={GLYPH_SIZES[size]} />
    </span>
  );
}

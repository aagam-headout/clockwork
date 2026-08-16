// The app's own mark, not a generic lucide glyph: an 8-tooth gear
// (automation) with an off-axis clock hand inside (a scheduled run) — cog
// driving a hand reads as "clockwork" directly. Kept in sync with
// app/icon.svg, same geometry with baked-in colors for the favicon.
// `LogoGlyph` inherits currentColor; `Logo` is the badge + glyph used in chrome.

// Teeth: 8 radial rectangles, r 6.6–8.6 around (12,12), 12° wide, spaced every
// 45°. Endpoints are precomputed to stay exact at any size.
const TEETH = [
  "M11.31 5.44 11.10 3.45 12.90 3.45 12.69 5.44Z",
  "M16.15 6.87 17.41 5.32 18.68 6.59 17.13 7.85Z",
  "M18.56 11.31 20.55 11.10 20.55 12.90 18.56 12.69Z",
  "M17.13 16.15 18.68 17.41 17.41 18.68 16.15 17.13Z",
  "M12.69 18.56 12.90 20.55 11.10 20.55 11.31 18.56Z",
  "M7.85 17.13 6.59 18.68 5.32 17.41 6.87 16.15Z",
  "M5.44 12.69 3.45 12.90 3.45 11.10 5.44 11.31Z",
  "M6.87 7.85 5.32 6.59 6.59 5.32 7.85 6.87Z",
];
// Body of the gear.
const RIM = { cx: 12, cy: 12, r: 6.4 };
// Hand: 12 o'clock to centre, then out to ~4 o'clock — off-axis so it reads
// as a hand mid-sweep, not a static cross.
const HANDS = "M12 12V8.6M12 12l3.6 2.5";

export function LogoGlyph({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {TEETH.map((d) => (
        <path key={d} d={d} fill="currentColor" stroke="none" />
      ))}
      <circle cx={RIM.cx} cy={RIM.cy} r={RIM.r} />
      <path d={HANDS} />
    </svg>
  );
}

const BADGE_SIZES = {
  sm: "h-8 w-8 rounded-control",
  md: "h-12 w-12 rounded-container",
} as const;

// Light-grey frosted glass; `.logo-badge` (globals.css) carries tint, blur
// and inner highlight for both themes.
const BADGE_BASE =
  "logo-badge flex items-center justify-center text-foreground";

const GLYPH_SIZES = {
  sm: "h-6 w-6",
  md: "h-8 w-8",
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

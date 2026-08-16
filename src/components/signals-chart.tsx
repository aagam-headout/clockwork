import { Card } from "@/components/ui";
import type { SignalDecl } from "@/lib/outcome/condition";
import type { SignalPoint } from "@/lib/data/digest-search";

/*
 * A signal's history, as a sparkline per numeric signal.
 *
 * Inline SVG, not a charting dependency: a few dozen points with no axes, no
 * tooltips, no interaction — smaller than the import would be.
 *
 * Every row tolerates a missing value. Outputs written before signals existed
 * have none, and a run that couldn't measure something reports it absent, not
 * zero — so a chart assuming presence would crash or, worse, draw a
 * confident zero where the truth is "unknown".
 */

const WIDTH = 320;
const HEIGHT = 40;

function Sparkline({ values }: { values: number[] }) {
  const min = Math.min(...values);
  const max = Math.max(...values);
  // A flat series has no range to scale against; a span of 1 keeps the line
  // centred instead of dividing by zero.
  const span = max - min || 1;

  const points = values
    .map((value, i) => {
      const x =
        values.length === 1 ? WIDTH / 2 : (i / (values.length - 1)) * WIDTH;
      const y = HEIGHT - ((value - min) / span) * HEIGHT;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");

  return (
    <svg
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      preserveAspectRatio="none"
      // `accent-text`, not `accent`: raw brand blue sits at ~3:1 on the dark
      // surface, the floor for a graphic. The text variant clears it in both
      // themes.
      className="text-accent-text h-10 w-full"
      aria-hidden
    >
      <polyline
        points={points}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        strokeLinejoin="round"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

export function SignalsChart({
  declared,
  points,
}: {
  declared: SignalDecl[];
  points: SignalPoint[];
}) {
  const series = declared
    .map((decl) => {
      const values = points
        .map((p) => p.signals?.[decl.key])
        .filter((v): v is number => typeof v === "number");
      return { decl, values };
    })
    // Two points is the minimum showing direction; one is just a number, and
    // the page already shows numbers elsewhere.
    .filter((s) => s.decl.type === "number" && s.values.length >= 2);

  if (series.length === 0) return null;

  return (
    <Card className="overflow-hidden">
      <div className="divide-border divide-y">
        {series.map(({ decl, values }) => {
          const latest = values[values.length - 1];
          const previous = values[values.length - 2];
          const delta = latest - previous;
          return (
            <div key={decl.key} className="px-5 py-4">
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-muted font-mono text-[13px]">
                  {decl.key}
                </span>
                <span className="flex items-baseline gap-2">
                  <span className="text-foreground font-mono text-sm tabular-nums">
                    {latest}
                  </span>
                  {delta !== 0 && (
                    <span
                      className={`font-mono text-xs tabular-nums ${
                        delta > 0 ? "text-success-text" : "text-danger-text"
                      }`}
                    >
                      {delta > 0 ? "+" : ""}
                      {Number(delta.toFixed(4))}
                    </span>
                  )}
                </span>
              </div>
              <div className="mt-2">
                <Sparkline values={values} />
              </div>
              <div className="text-subtle mt-1 flex justify-between text-[11px] tabular-nums">
                <span>{Math.min(...values)}</span>
                <span>
                  {values.length} run{values.length === 1 ? "" : "s"}
                </span>
                <span>{Math.max(...values)}</span>
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

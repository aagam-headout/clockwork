// One card treatment used everywhere: workflow rows, run rows, connection
// rows, the today feed, step traces. Interactive variant adds a hover lift.
export function cardClass(interactive = false) {
  return [
    "rounded-xl border border-border bg-card p-4 shadow-sm transition-shadow",
    interactive && "hover:shadow-md hover:border-foreground/20",
  ]
    .filter(Boolean)
    .join(" ");
}

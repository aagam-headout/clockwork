// Client-safe constants — no Composio SDK import here (it pulls in Node-only
// deps like `fs` that break client bundles). Server code can still import
// these via `@/lib/composio`, which re-exports them.
export const TOOLKITS = [
  "googlecalendar",
  "gmail",
  "slack",
  "notion",
  "github",
] as const;
export type Toolkit = (typeof TOOLKITS)[number];

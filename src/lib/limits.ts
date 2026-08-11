/**
 * Every quota in the app, in one place, each overridable by environment.
 *
 * Signup is open, so these are not tuning knobs — they are the thing standing
 * between one abusive account and the shared resources this app runs on: the
 * app-wide Composio API key, the cron tick's time budget, and the database.
 * Model spend is the user's own (bring-your-own-key), which is why there is no
 * dollar cap here.
 */
function num(name: string, fallback: number): number {
  const raw = process.env[name];
  const parsed = raw ? Number(raw) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export const LIMITS = {
  /** Workflows a user may own at all. */
  maxWorkflowsPerUser: num("MAX_WORKFLOWS_PER_USER", 20),
  /** …of which this many may be scheduled at once. */
  maxEnabledPerUser: num("MAX_ENABLED_WORKFLOWS_PER_USER", 10),
  /** The tick runs every 5 minutes; a faster cron is a lie. */
  minCronIntervalMinutes: num("MIN_CRON_INTERVAL_MINUTES", 15),
  /** Runs in flight for one user. */
  maxConcurrentRuns: num("MAX_CONCURRENT_RUNS_PER_USER", 3),
  maxRunsPerHour: num("MAX_RUNS_PER_USER_PER_HOUR", 60),
  maxRunsPerDay: num("MAX_RUNS_PER_USER_PER_DAY", 300),
  /** Connected apps per user — bounds the shared Composio key's exposure. */
  maxConnectionsPerUser: num("MAX_CONNECTIONS_PER_USER", 10),
  /** Consecutive connection-blocked runs before the workflow is paused. */
  maxConnectionFailures: num("MAX_CONNECTION_FAILURES", 3),
  /** Ceiling on a workflow's agent steps, whatever the form posts. */
  maxSteps: 30,
  maxEventTriggers: num("MAX_EVENT_TRIGGERS", 10),
  maxDeliverTargets: num("MAX_DELIVER_TARGETS", 5),
} as const;

/** How long the OAuth callback waits for Composio to finish the handshake. */
export const CONNECT_WAIT_MS = num("CONNECT_WAIT_MS", 15_000);

/** A connection row older than this is re-read from Composio by the sweep. */
export const RECONCILE_TTL_MS = num("RECONCILE_TTL_MS", 6 * 60 * 60 * 1000);

/** Users reconciled per cron tick — bounds the sweep against the tick budget. */
export const RECONCILE_BATCH = num("RECONCILE_BATCH", 25);

/**
 * Fixed-window rate limits, by bucket.
 *
 * `propose` is the expensive one: two model calls plus a round of live tool
 * calls per request. The others guard the shared Composio key rather than
 * money.
 */
export const RATE_LIMITS = {
  propose: { limit: num("MAX_PROPOSE_PER_HOUR", 20), windowMs: 60 * 60 * 1000 },
  toolkit_search: {
    limit: num("MAX_TOOLKIT_SEARCH_PER_MIN", 60),
    windowMs: 60_000,
  },
  connect: { limit: num("MAX_CONNECT_PER_5MIN", 10), windowMs: 5 * 60 * 1000 },
  key_verify: {
    limit: num("MAX_KEY_VERIFY_PER_HOUR", 10),
    windowMs: 60 * 60 * 1000,
  },
} as const;

export type RateLimitBucket = keyof typeof RATE_LIMITS;

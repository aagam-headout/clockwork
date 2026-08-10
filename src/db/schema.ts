import { sql } from "drizzle-orm";
import {
  pgTable,
  uniqueIndex,
  index,
  uuid,
  text,
  boolean,
  integer,
  jsonb,
  timestamp,
  numeric,
} from "drizzle-orm/pg-core";

export const workflows = pgTable("workflows", {
  id: uuid("id").primaryKey().defaultRandom(),
  slug: text("slug").notNull().unique(),
  /*
   * Who owns this workflow. Load-bearing for scheduled runs: a cron tick has
   * no session, so this is the only way the executor can tell whose provider
   * setting to route the run through. Null on rows created before the column
   * existed — those fall back to the app default.
   */
  ownerEmail: text("owner_email"),
  name: text("name").notNull(),
  goal: text("goal").notNull(), // the natural-language prompt
  // "cron" runs on `cron`/`timezone`; "event" runs when one of
  // `eventTriggers` fires as a Composio webhook.
  triggerType: text("trigger_type").notNull().default("cron"),
  cron: text("cron").notNull(), // "0 8 * * 1-5" — "" for event workflows
  timezone: text("timezone").notNull().default("Asia/Kolkata"),
  eventTriggers: text("event_triggers").array().notNull().default([]),
  toolkits: text("toolkits").array().notNull().default([]),
  allowTools: text("allow_tools").array().notNull().default([]),
  denyTools: text("deny_tools").array().notNull().default([]),
  deliver: jsonb("deliver").notNull().default([]), // [{type:"slack_dm"},{type:"dashboard"}]
  model: text("model").notNull().default("anthropic/claude-sonnet-5"),
  maxSteps: integer("max_steps").notNull().default(15),
  readOnly: boolean("read_only").notNull().default(true),
  enabled: boolean("enabled").notNull().default(true),
  /** Last *successful* run — what the UI means by "last ran". */
  lastRunAt: timestamp("last_run_at", { withTimezone: true }),
  /**
   * Last time a run was *claimed* for this workflow, success or not. The
   * scheduler dues off this one so a failing workflow doesn't stay due and
   * re-fire on every tick.
   */
  lastAttemptAt: timestamp("last_attempt_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const runs = pgTable(
  "runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workflowId: uuid("workflow_id")
      .notNull()
      .references(() => workflows.id, { onDelete: "cascade" }),
    trigger: text("trigger").notNull(), // "cron" | "manual" | "event"
    // queued | running | ok | truncated | error
    status: text("status").notNull().default("queued"),
    /** Why the model stopped — "stop", "tool-calls", "length"… */
    finishReason: text("finish_reason"),
    /** Composio trigger event id, for event-triggered runs (dedupe key). */
    triggerRef: text("trigger_ref"),
    triggerPayload: jsonb("trigger_payload"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    durationMs: integer("duration_ms"),
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    costUsd: numeric("cost_usd", { precision: 10, scale: 6 }),
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    /*
     * At most one in-flight run per workflow, enforced by the database —
     * a cron tick and a "Run now" click racing each other is otherwise a
     * double execution (and a doubled bill).
     */
    uniqueIndex("runs_one_active_per_workflow")
      .on(table.workflowId)
      .where(sql`status in ('queued', 'running')`),
    // Composio retries webhooks; the same event must not start two runs.
    uniqueIndex("runs_trigger_ref_unique")
      .on(table.triggerRef)
      .where(sql`trigger_ref is not null`),
    index("runs_workflow_created_idx").on(table.workflowId, table.createdAt),
  ],
);

export const runSteps = pgTable("run_steps", {
  id: uuid("id").primaryKey().defaultRandom(),
  runId: uuid("run_id")
    .notNull()
    .references(() => runs.id, { onDelete: "cascade" }),
  idx: integer("idx").notNull(),
  type: text("type").notNull(), // "tool" | "text"
  toolSlug: text("tool_slug"),
  argsJson: jsonb("args_json"),
  resultJson: jsonb("result_json"),
  durationMs: integer("duration_ms"),
  error: text("error"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const outputs = pgTable("outputs", {
  id: uuid("id").primaryKey().defaultRandom(),
  runId: uuid("run_id")
    .notNull()
    .references(() => runs.id, { onDelete: "cascade" }),
  format: text("format").notNull().default("markdown"),
  body: text("body").notNull(),
  deliveredTo: text("delivered_to").array().notNull().default([]),
  /** Per-target outcome: [{type, ok, error?}] — a failed send is recorded. */
  deliveryLog: jsonb("delivery_log").notNull().default([]),
  /** The agent found nothing new since the previous digest. */
  unchanged: boolean("unchanged").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// v2 — table created now, unused until write-mode ships
export const pendingActions = pgTable("pending_actions", {
  id: uuid("id").primaryKey().defaultRandom(),
  runId: uuid("run_id")
    .notNull()
    .references(() => runs.id, { onDelete: "cascade" }),
  toolSlug: text("tool_slug").notNull(),
  argsJson: jsonb("args_json").notNull(),
  status: text("status").notNull().default("pending"), // pending | approved | rejected
  decidedAt: timestamp("decided_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// v1 — Composio connected accounts cache (source of truth is Composio; this
// just lets the dashboard render connection status without an API round trip)
export const connections = pgTable("connections", {
  id: uuid("id").primaryKey().defaultRandom(),
  toolkit: text("toolkit").notNull().unique(),
  composioConnectedAccountId: text("composio_connected_account_id"),
  status: text("status").notNull().default("not_connected"), // not_connected | pending | active | error
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/*
 * Per-account settings, one row per signed-in user, keyed by email.
 *
 * Email rather than the auth provider's user id: it is the identity this app
 * already gates on (OWNER_EMAIL), and it is the one identifier available both
 * under Neon Auth and under the local bypass, which mints no user id at all.
 */
export const userSettings = pgTable("user_settings", {
  email: text("email").primaryKey(),
  /** Which SDK provider serves models: "gateway" | "anthropic" | "openai". */
  modelProvider: text("model_provider").notNull().default("gateway"),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

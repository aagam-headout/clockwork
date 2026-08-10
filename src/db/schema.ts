import {
  pgTable,
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
  name: text("name").notNull(),
  goal: text("goal").notNull(), // the natural-language prompt
  cron: text("cron").notNull(), // "0 8 * * 1-5"
  timezone: text("timezone").notNull().default("Asia/Kolkata"),
  toolkits: text("toolkits").array().notNull().default([]),
  allowTools: text("allow_tools").array().notNull().default([]),
  denyTools: text("deny_tools").array().notNull().default([]),
  deliver: jsonb("deliver").notNull().default([]), // [{type:"slack_dm"},{type:"dashboard"}]
  model: text("model").notNull().default("anthropic/claude-sonnet-5"),
  maxSteps: integer("max_steps").notNull().default(15),
  readOnly: boolean("read_only").notNull().default(true),
  enabled: boolean("enabled").notNull().default(true),
  lastRunAt: timestamp("last_run_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const runs = pgTable("runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  workflowId: uuid("workflow_id")
    .notNull()
    .references(() => workflows.id, { onDelete: "cascade" }),
  trigger: text("trigger").notNull(), // "cron" | "manual"
  status: text("status").notNull().default("queued"), // queued | running | ok | error
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
});

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

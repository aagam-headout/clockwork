import { sql } from "drizzle-orm";
import {
  pgTable,
  uniqueIndex,
  index,
  primaryKey,
  foreignKey,
  uuid,
  text,
  boolean,
  integer,
  jsonb,
  timestamp,
  numeric,
} from "drizzle-orm/pg-core";

/*
 * One row per person who has signed in. `id` is the app's own identity and the
 * only thing anything else keys off — including Composio, whose per-user
 * namespace is derived from it (see `src/lib/composio/identity.ts`).
 *
 * The join key from a session is `authUserId`, not email: Neon Auth is
 * better-auth underneath and hands back a stable `user.id`, so a user changing
 * their email address is a one-column UPDATE here rather than a rewrite of
 * every owned row in every table.
 */
export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /*
     * Neon Auth's user id. Nullable because two kinds of row exist before any
     * Neon Auth id is known — the OWNER_EMAIL row seeded by the multi-user
     * backfill, and the LOCAL_AUTH_BYPASS row the Docker stack runs as. Both
     * are adopted by the first matching sign-in (see `ensureUser`).
     */
    authUserId: text("auth_user_id").unique(),
    /** Lowercased. Display and backfill only — never the identity. */
    email: text("email").notNull(),
    name: text("name"),
    imageUrl: text("image_url"),
    /**
     * active | suspended. Signup is open, so this is the lever for shutting
     * off an abusive account; flip it with psql, there is no admin UI.
     */
    status: text("status").notNull().default("active"),
    /** Per-user override of the default workflow cap; null = use the default. */
    workflowLimit: integer("workflow_limit"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
  },
  (table) => [
    // Functional index, so `Foo@x.com` and `foo@x.com` can never both exist
    // even if some future caller forgets to lowercase.
    uniqueIndex("users_email_unique").on(sql`lower(${table.email})`),
  ],
);

/*
 * Bring-your-own-key: each user's model-provider credential, encrypted at rest
 * with AES-256-GCM (see `src/lib/crypto/secrets.ts`).
 *
 * Deliberately its own table rather than columns on `user_settings`. A user
 * holds up to three of these at once, and — more importantly — `user_settings`
 * gets selected wholesale into server components. Key material living in a
 * separate narrow table means putting ciphertext into an RSC payload takes a
 * deliberate query against a table nothing else touches.
 */
export const userProviderKeys = pgTable(
  "user_provider_keys",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(), // gateway | anthropic | openai
    ciphertext: text("ciphertext").notNull(), // base64
    iv: text("iv").notNull(), // base64, 12 bytes
    authTag: text("auth_tag").notNull(), // base64, 16 bytes
    /** Which ENCRYPTION_KEY sealed this row. Rotation is a version bump. */
    keyVersion: text("key_version").notNull().default("v1"),
    /** Last 4 characters of the plaintext — the only part a browser ever sees. */
    last4: text("last4").notNull(),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("user_provider_keys_user_provider").on(
      table.userId,
      table.provider,
    ),
  ],
);

export const workflows = pgTable(
  "workflows",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Unique per owner, not globally — see the index at the bottom of this table. */
    slug: text("slug").notNull(),
    /*
     * Who owns this workflow. Load-bearing twice over: it scopes every read and
     * mutation (a cron tick and a webhook have no session, so the row itself is
     * the only statement of ownership), and it selects whose provider key and
     * whose Composio connections the run goes through.
     *
     */
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    goal: text("goal").notNull(), // the natural-language prompt
    // "cron" runs on `cron`/`timezone`; "event" runs when one of
    // `eventTriggers` fires as a Composio webhook; "workflow" runs when
    // `parentWorkflowId` finishes and `parentCondition` holds.
    triggerType: text("trigger_type").notNull().default("cron"),
    cron: text("cron").notNull(), // "0 8 * * 1-5" — "" for event workflows
    timezone: text("timezone").notNull().default("Asia/Kolkata"),
    eventTriggers: text("event_triggers").array().notNull().default([]),
    /*
     * Chaining. The link lives on the child, matching every other trigger in
     * this table: the trigger always belongs to the workflow that fires. The
     * alternative — a list of children on the parent — would make a child's
     * own `triggerType` a lie, and leave dangling ids with no key to catch
     * them when a child is deleted.
     *
     * SET NULL rather than cascade, because deleting a parent must not delete
     * a child's run history. The orphan is paused with `pausedReason`
     * 'parent_deleted' instead, which reuses the existing re-enable path.
     */
    parentWorkflowId: uuid("parent_workflow_id"),
    /** Expression over the PARENT's signals; null fires the child always. */
    parentCondition: text("parent_condition"),
    /** Expression over THIS workflow's own signals; null always delivers. */
    alertCondition: text("alert_condition"),
    /** [{key, type, description}] — what the `report` tool may fill. */
    signalSchema: jsonb("signal_schema").notNull().default([]),
    toolkits: text("toolkits").array().notNull().default([]),
    allowTools: text("allow_tools").array().notNull().default([]),
    denyTools: text("deny_tools").array().notNull().default([]),
    deliver: jsonb("deliver").notNull().default([]), // [{type:"slack_dm"},{type:"dashboard"}]
    model: text("model").notNull().default("anthropic/claude-sonnet-5"),
    maxSteps: integer("max_steps").notNull().default(15),
    readOnly: boolean("read_only").notNull().default(true),
    enabled: boolean("enabled").notNull().default(true),
    /**
     * Consecutive runs blocked by a missing/expired connection. Reset to 0 by
     * any successful run and by a reconnect; at the limit the workflow is paused
     * rather than left to fail on every tick forever.
     */
    connectionFailures: integer("connection_failures").notNull().default(0),
    /**
     * Why `enabled` is false, when the app turned it off rather than the user.
     * "needs_reconnect" is the only value today — it is also the marker that
     * lets a reconnect re-enable exactly the workflows it paused, and nothing
     * the user paused by hand.
     */
    pausedReason: text("paused_reason"),
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
  },
  (table) => [
    /*
     * Per-owner slug uniqueness. Globally unique was both a collision — one
     * account naming a workflow "digest" pushed the next account's to "digest-2"
     * — and an oracle: the suffix you got back told you whether a stranger
     * already owned that name.
     */
    uniqueIndex("workflows_user_slug_unique").on(table.userId, table.slug),
    index("workflows_user_created_idx").on(table.userId, table.createdAt),
    index("workflows_user_enabled_idx").on(table.userId, table.enabled),
    // The scoped webhook fan-out filters on all three.
    index("workflows_user_trigger_enabled_idx").on(
      table.userId,
      table.triggerType,
      table.enabled,
    ),
    /*
     * Declared here rather than with `references()` on the column: drizzle
     * cannot reference a table from inside its own definition.
     */
    foreignKey({
      columns: [table.parentWorkflowId],
      foreignColumns: [table.id],
      name: "workflows_parent_fk",
    }).onDelete("set null"),
    // Every finished run asks "who are this workflow's children?".
    index("workflows_parent_idx").on(table.parentWorkflowId),
  ],
);

export const runs = pgTable(
  "runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workflowId: uuid("workflow_id")
      .notNull()
      .references(() => workflows.id, { onDelete: "cascade" }),
    trigger: text("trigger").notNull(), // "cron" | "manual" | "event" | "workflow"
    // queued | running | ok | truncated | error
    status: text("status").notNull().default("queued"),
    /** Why the model stopped — "stop", "tool-calls", "length"… */
    finishReason: text("finish_reason"),
    /** Composio trigger event id, for event-triggered runs (dedupe key). */
    triggerRef: text("trigger_ref"),
    triggerPayload: jsonb("trigger_payload"),
    /** The run that chained into this one, for provenance on the run page. */
    parentRunId: uuid("parent_run_id"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    durationMs: integer("duration_ms"),
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    costUsd: numeric("cost_usd", { precision: 10, scale: 6 }),
    error: text("error"),
    /*
     * Machine-readable companion to `error`. The status stays "error" — adding
     * a fourth terminal status would touch the one-active-run index predicate,
     * the previous-failure lookup, retention, and every stat tile, for nothing
     * this field doesn't already give.
     *
     * "needs_reconnect" — a required toolkit had no working connection, either
     * caught by the preflight or by an auth rejection mid-run.
     */
    errorCode: text("error_code"),
    /** Which toolkits the error is about, so the UI can offer "Reconnect X". */
    errorToolkits: text("error_toolkits").array().notNull().default([]),
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
    foreignKey({
      columns: [table.parentRunId],
      foreignColumns: [table.id],
      name: "runs_parent_run_fk",
    }).onDelete("set null"),
    /*
     * The tick's drain pass takes the oldest queued chained run on every
     * iteration. A partial index keeps that a single-row lookup instead of a
     * scan over every run ever recorded.
     */
    index("runs_queued_chained_idx")
      .on(table.createdAt)
      .where(sql`status = 'queued' and trigger = 'workflow'`),
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

/*
 * What each tool call returned last time, as a hash.
 *
 * Only hashes — never payloads. A matching hash lets the executor tell the
 * model "this source is byte-identical to last run" in one line instead of
 * re-sending the payload, and because the tool still ran, that statement is
 * about live data rather than a cached read.
 *
 * One row per distinct call shape per workflow, overwritten each run, so it
 * cannot grow beyond a workflow's own variety of calls and needs no retention
 * sweep.
 */
export const runToolHashes = pgTable(
  "run_tool_hashes",
  {
    workflowId: uuid("workflow_id")
      .notNull()
      .references(() => workflows.id, { onDelete: "cascade" }),
    toolSlug: text("tool_slug").notNull(),
    /** sha256 of the call's arguments with object keys recursively sorted. */
    argsHash: text("args_hash").notNull(),
    resultHash: text("result_hash").notNull(),
    seenAt: timestamp("seen_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({
      columns: [table.workflowId, table.toolSlug, table.argsHash],
    }),
  ],
);

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
  /** The envelope's measured values, as reported by the `report` tool. */
  signals: jsonb("signals"),
  /** info | warn | critical — the agent's own read of urgency. */
  severity: text("severity"),
  /*
   * The digest was withheld because `alertCondition` evaluated false.
   *
   * Deliberately not `unchanged`: that means the agent found nothing new,
   * while this means it found something that did not clear the bar. Collapsing
   * the two would make a working threshold indistinguishable from a quiet
   * week, which is the failure this column exists to prevent.
   *
   * Also carries the two "delivered anyway" notes — condition_indeterminate
   * and condition_error — which sit alongside a delivered digest rather than
   * instead of one, so the run page can say the threshold did not actually
   * gate that delivery.
   */
  suppressed: boolean("suppressed").notNull().default(false),
  suppressedReason: text("suppressed_reason"),
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

/*
 * Composio connection state, one row per (user, toolkit).
 *
 * Postgres is the read path: every page, the workflow builder, the run
 * preflight and the dispatcher ask "is this toolkit usable for this user?",
 * and answering that from Composio meant an API round trip on every render —
 * plus a `Promise.allSettled` fallback that silently emptied the builder's
 * toolkit list whenever Composio was down. Composio remains the source of
 * truth; the reconcile job pulls it back in.
 *
 * Keyed per toolkit rather than per connected account because that is the
 * question the whole app asks. Multiple Composio accounts for one toolkit do
 * exist transiently during a reconnect — they live in `pendingAccountId` and
 * `staleAccountIds` until the flow settles.
 */
export const connections = pgTable(
  "connections",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    toolkit: text("toolkit").notNull(),
    /** The account currently in use. Null while a first connect is in flight. */
    composioConnectedAccountId: text("composio_connected_account_id"),
    /** Created by an in-flight connect/reconnect; promoted on callback. */
    pendingAccountId: text("pending_account_id"),
    /** Superseded accounts we mean to delete at Composio but haven't confirmed. */
    staleAccountIds: text("stale_account_ids").array().notNull().default([]),
    authConfigId: text("auth_config_id"),
    // initiated | active | expired | failed | revoked | inactive | disconnected
    status: text("status").notNull().default("disconnected"),
    statusReason: text("status_reason"),
    /** Ties an OAuth callback to the connect that started it. */
    pendingNonce: text("pending_nonce"),
    pendingStartedAt: timestamp("pending_started_at", { withTimezone: true }),
    connectedAt: timestamp("connected_at", { withTimezone: true }),
    /** Drives the reconcile sweep; stale rows get re-read from Composio. */
    lastCheckedAt: timestamp("last_checked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("connections_user_toolkit_uniq").on(
      table.userId,
      table.toolkit,
    ),
    // Lets the trigger webhook map a connected account back to its owner.
    uniqueIndex("connections_account_uniq")
      .on(table.composioConnectedAccountId)
      .where(sql`composio_connected_account_id is not null`),
    index("connections_user_status_idx").on(table.userId, table.status),
  ],
);

/*
 * Composio trigger instances we created, so we can delete them again.
 *
 * This table is not a cache — it is the only record that exists. The SDK's
 * `triggers.listActive` has no user filter and its items carry no user id, so
 * without persisting the returned trigger id here, a trigger created for a
 * workflow can never be found and deregistered once that workflow changes.
 */
export const triggerInstances = pgTable(
  "trigger_instances",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    triggerSlug: text("trigger_slug").notNull(),
    composioTriggerId: text("composio_trigger_id"),
    connectedAccountId: text("connected_account_id"),
    status: text("status").notNull().default("active"), // active | failed
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("trigger_instances_user_slug_uniq").on(
      table.userId,
      table.triggerSlug,
    ),
  ],
);

/*
 * Fixed-window rate limit counters.
 *
 * In Postgres rather than in memory because the app runs on Vercel: a module
 * counter lives in one lambda instance, so it neither shares a limit across
 * concurrent instances nor survives a cold start. There is no Redis in this
 * stack, and the request volume this guards is low enough that a single
 * upsert per call is cheap.
 */
export const rateLimits = pgTable(
  "rate_limits",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    bucket: text("bucket").notNull(), // "propose" | "toolkit_search" | "connect" | …
    windowStart: timestamp("window_start", { withTimezone: true }).notNull(),
    count: integer("count").notNull().default(0),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.bucket, table.windowStart] }),
  ],
);

/*
 * Per-account settings, one row per user.
 *
 * `email` was the original key, from when the app gated on a single
 * OWNER_EMAIL. `userId` supersedes it and becomes the primary key in a later
 * migration; until then both are carried so a mid-rollout instance can read
 * either.
 */
export const userSettings = pgTable("user_settings", {
  email: text("email").primaryKey(),
  userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }),
  /** Which SDK provider serves models: "gateway" | "anthropic" | "openai". */
  modelProvider: text("model_provider").notNull().default("gateway"),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

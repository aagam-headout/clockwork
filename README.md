# Clockwork

Scheduled agents that read your apps and report back.

Built with [Next.js](https://nextjs.org), the AI SDK, Composio, and Neon.

## How it works

A **workflow** is a plain-English goal, a trigger, a set of Composio toolkits,
and one or more delivery targets. When it fires, an agent runs the goal with
read-only access to those toolkits and writes a short digest.

- **Triggers** — a cron expression in your own timezone, or a Composio event
  (new email, issue assigned, Slack mention) delivered by webhook.
- **Read-only by construction** — write tools are filtered out server-side
  before the model ever sees a schema. The only exceptions are the specific
  tools a delivery target needs.
- **Memory** — each run is shown the previous digest and reports only what
  changed. A run with nothing new sends nothing; it just records that.
- **One run at a time** — a partial unique index makes a concurrent cron tick
  and "Run now" impossible to double-execute.

## Running locally with Docker

The compose stack replaces the three hosted pieces — Neon (Postgres), Vercel
(the app), GitHub Actions (the scheduler) — with local containers. Composio
and the AI Gateway are remote APIs either way, so those still need real keys.

```bash
cp .env.docker.example .env.docker   # then fill in the two API keys
pnpm docker:up                       # app on http://localhost:3000
```

| Service   | What it stands in for                                         |
| --------- | ------------------------------------------------------------- |
| `db`      | Neon — plain Postgres 17, on `localhost:5444`                 |
| `migrate` | one-shot `drizzle-kit migrate`, runs before the app starts    |
| `app`     | Vercel — `next dev` with the repo bind-mounted for hot reload |
| `ticker`  | the GitHub Actions cron — POSTs `/api/cron/tick` every 5 min  |

Useful bits:

```bash
APP_PORT=3100 pnpm docker:up   # if 3000 is already taken
pnpm docker:tick               # fire a tick immediately instead of waiting
pnpm docker:psql               # psql into the local database
pnpm docker:reset              # tear down and drop the data volume
```

Neon Auth has no local equivalent, so `LOCAL_AUTH_BYPASS=true` treats the
local user as the owner. It is double-locked to non-production builds (see
`src/lib/auth/local.ts`) — never set it in a deployed environment.

Event triggers need Composio to reach your machine: run a tunnel
(`ngrok http 3000`), point `APP_URL` at it, and set
`COMPOSIO_WEBHOOK_SECRET`.

## Running against the cloud

`pnpm dev` with a `.env.local` that has `DATABASE_URL` pointing at Neon. The
database layer picks its driver from the URL — Neon's HTTP driver for
`*.neon.tech`, a normal TCP pool for anything else.

## Checks

```bash
pnpm test        # unit tests (schedule, tool filter, cost)
pnpm exec tsc --noEmit
pnpm lint
pnpm build
```

## Database changes

```bash
pnpm db:generate --name=what_it_does   # always name the migration
pnpm db:migrate
```

Migrations run against `DATABASE_URL_UNPOOLED` — a direct connection, since
PgBouncer's transaction mode can't handle the session-level statements
drizzle-kit issues.

## Environment

| Variable                                         | Purpose                                         |
| ------------------------------------------------ | ----------------------------------------------- |
| `DATABASE_URL` / `DATABASE_URL_UNPOOLED`         | app traffic / migrations                        |
| `COMPOSIO_API_KEY`                               | tool calls                                      |
| `AI_GATEWAY_API_KEY`                             | model routing and live pricing                  |
| `ANTHROPIC_API_KEY`                              | only if Settings → provider is set to Anthropic |
| `OPENAI_API_KEY`                                 | only if Settings → provider is set to OpenAI    |
| `CRON_SECRET`                                    | bearer token for `/api/cron/tick`               |
| `OWNER_EMAIL`                                    | the single account allowed in                   |
| `NEON_AUTH_BASE_URL` / `NEON_AUTH_COOKIE_SECRET` | hosted auth (not needed with the local bypass)  |
| `APP_URL` / `COMPOSIO_WEBHOOK_SECRET`            | event triggers                                  |
| `RUN_RETENTION_DAYS`                             | how long run history is kept (default 30)       |
| `LOCAL_AUTH_BYPASS`                              | development only — see above                    |

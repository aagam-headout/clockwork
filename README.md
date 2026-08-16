# Clockwork

Scheduled agents that read your apps and report back.

Built with [Next.js](https://nextjs.org), the AI SDK, Composio, and Neon.

## Deploy your own

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Faagam-headout%2Fclockwork&project-name=clockwork&repository-name=clockwork&stores=%5B%7B%22type%22%3A%22integration%22%2C%22integrationSlug%22%3A%22neon%22%2C%22productSlug%22%3A%22neon%22%2C%22protocol%22%3A%22storage%22%7D%5D&env=ENCRYPTION_KEY%2CNEON_AUTH_COOKIE_SECRET%2CCRON_SECRET%2CCOMPOSIO_API_KEY&envDescription=Two+random+secrets+you+generate%2C+a+cron+secret%2C+and+your+Composio+API+key.+Instructions+in+the+link.&envLink=https%3A%2F%2Fgithub.com%2Faagam-headout%2Fclockwork%2Fblob%2Fmain%2FSELF-HOSTING.md%23environment-variables)

Runs entirely on your own Vercel, Neon, and Composio accounts. The button
provisions the database and prompts for four secrets; two short manual steps
follow. Full walkthrough in [SELF-HOSTING.md](./SELF-HOSTING.md).

## How it works

A **workflow** is a plain-English goal, a trigger, a set of Composio toolkits,
and one or more delivery targets. When it fires, an agent runs the goal with
read-only access to those toolkits and writes a short digest.

- **Triggers** — a cron expression in your own timezone, a Composio event
  (new email, issue assigned, Slack mention) delivered by webhook, or another
  workflow finishing (chaining, below).
- **Read-only by construction** — write tools are filtered out server-side
  before the model ever sees a schema. The only exceptions are the specific
  tools a delivery target needs.
- **Memory** — each run is shown the previous digest and reports only what
  changed. A run with nothing new sends nothing; it just records that.
- **One run at a time** — a partial unique index makes a concurrent cron tick
  and "Run now" impossible to double-execute.
- **Signals and thresholds** — a workflow can declare a few named values
  (numbers, strings, or booleans) it expects the agent to report each run,
  and gate delivery on an alert condition over them (`open_incidents > 5`).
  Below the threshold, the digest is recorded but not sent.
- **Chaining** — a workflow can run as a step after another, optionally gated
  on the parent's reported signals, so "check for incidents" can trigger
  "page on-call" only when the count crosses zero. Depth and fan-out are
  both bounded.
- **History search** — every past digest is full-text searchable, from a
  `/runs` search box and from the agent's own `history` tool, so a run can
  tell a one-off from a trend without spending its step budget re-fetching.
- **Cost caps** — an optional monthly USD ceiling per workflow. Once crossed,
  the workflow pauses itself rather than keep spending.
- **Delivery outcomes** — a digest that partly or fully failed to reach its
  targets (an expired Slack token, a dead webhook) is flagged as such rather
  than looking like a normal, quiet run.

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
pnpm test        # unit tests (schedule, tool filter, cost, chaining, outcome routing)
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

| Variable                                         | Purpose                                                     |
| ------------------------------------------------ | ----------------------------------------------------------- |
| `DATABASE_URL` / `DATABASE_URL_UNPOOLED`         | app traffic / migrations                                    |
| `COMPOSIO_API_KEY`                               | tool calls                                                  |
| `AI_GATEWAY_API_KEY`                             | model routing and live pricing                              |
| `ANTHROPIC_API_KEY`                              | only if Settings → provider is set to Anthropic             |
| `OPENAI_API_KEY`                                 | only if Settings → provider is set to OpenAI                |
| `CRON_SECRET`                                    | bearer token for `/api/cron/tick`                           |
| `OWNER_EMAIL`                                    | the single account allowed in                               |
| `NEON_AUTH_BASE_URL` / `NEON_AUTH_COOKIE_SECRET` | hosted auth (not needed with the local bypass)              |
| `APP_URL` / `COMPOSIO_WEBHOOK_SECRET`            | event triggers                                              |
| `RUN_RETENTION_DAYS`                             | how long run history is kept (default 30)                   |
| `MAX_CHAIN_DEPTH`                                | how many workflows deep a chain may run (default 3)         |
| `MAX_CHILDREN_PER_WORKFLOW`                      | how many chained children one workflow may have (default 3) |
| `MAX_SIGNALS_PER_WORKFLOW`                       | signals one workflow may declare (default 10)               |
| `LOCAL_AUTH_BYPASS`                              | development only — see above                                |

`APP_URL` and `NEON_AUTH_BASE_URL` fall back to the deployment's own domain via
`VERCEL_PROJECT_PRODUCTION_URL`, so on Vercel they're only needed for a custom
domain. Copy `.env.example` to `.env.local` for a cloud-backed `pnpm dev`.

## License

MIT — see [LICENSE](./LICENSE).

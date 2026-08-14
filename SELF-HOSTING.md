# Self-hosting Clockwork

Clockwork runs on your own Vercel account, your own Neon database, and your own
Composio project. Nothing routes through anyone else's infrastructure, and the
model API keys stay per-user inside your instance.

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Faagam-headout%2Fclockwork&project-name=clockwork&repository-name=clockwork&stores=%5B%7B%22type%22%3A%22integration%22%2C%22integrationSlug%22%3A%22neon%22%2C%22productSlug%22%3A%22neon%22%2C%22protocol%22%3A%22storage%22%7D%5D&env=ENCRYPTION_KEY%2CNEON_AUTH_COOKIE_SECRET%2CCRON_SECRET%2CCOMPOSIO_API_KEY&envDescription=Two+random+secrets+you+generate%2C+a+cron+secret%2C+and+your+Composio+API+key.+Instructions+in+the+link.&envLink=https%3A%2F%2Fgithub.com%2Faagam-headout%2Fclockwork%2Fblob%2Fmain%2FSELF-HOSTING.md%23environment-variables)

The button clones the repo into your GitHub account, provisions a Neon database
through the Vercel Marketplace, and asks for four values before the first build.
Two more steps follow the deploy: enabling Neon Auth, and picking a scheduler.

## 1. Get your secrets ready

Have these four in hand before you click the button — the deploy pauses on the
environment-variable screen and you can't proceed without them.

### Environment variables

| Variable                  | How to get it                                                                                                                 |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `ENCRYPTION_KEY`          | `openssl rand -base64 32` — encrypts users' model-provider API keys at rest (AES-256-GCM). Losing it means losing those keys. |
| `NEON_AUTH_COOKIE_SECRET` | `openssl rand -base64 32` — signs session cookies. Must be at least 32 characters.                                            |
| `CRON_SECRET`             | `openssl rand -base64 32` — the shared secret the scheduler presents to `/api/cron/tick`.                                     |
| `COMPOSIO_API_KEY`        | Create a free project at [app.composio.dev](https://app.composio.dev) and copy its API key. This is what reads your apps.     |

Everything else is provisioned or inferred:

- `DATABASE_URL` and `DATABASE_URL_UNPOOLED` come from the Neon integration the
  button installs. The names match what Clockwork already reads — nothing to set.
- `NEON_AUTH_BASE_URL` and `APP_URL` fall back to your deployment's own domain
  via `VERCEL_PROJECT_PRODUCTION_URL`. Set them explicitly only if you put
  Clockwork behind a custom domain.
- Model provider keys (Anthropic, OpenAI, AI Gateway) are entered per user in
  the app's settings and stored encrypted. There is no instance-wide model key.

## 2. Deploy

Click the button. The build runs `pnpm db:migrate && pnpm build`, so the schema
is created on the first deploy and kept current on every deploy after.

> A failing migration fails the deploy. That's deliberate — a half-migrated
> database is worse than a deploy that didn't ship.
>
> If you enable preview deployments, give them their own Neon branch. Otherwise
> a preview build migrates your production database.

## 3. Enable Neon Auth

The Marketplace integration provisions the database but **not** authentication.
Open your Neon project, go to **Auth**, and enable it on your production branch.
Until you do, sign-in will fail.

## 4. Choose a scheduler

Clockwork's `/api/cron/tick` endpoint decides which workflows are due. Something
has to call it. Two options ship with the repo, and they're interchangeable —
the tick is idempotent, so running both is harmless.

### Vercel Cron (default, no setup)

`vercel.json` already declares a cron job. It runs **once a day at 09:00 UTC**,
because the Vercel Hobby plan caps cron jobs at once per day.

On **Pro**, edit `vercel.json` to the real cadence and redeploy:

```json
"crons": [{ "path": "/api/cron/tick", "schedule": "*/5 * * * *" }]
```

Vercel attaches `CRON_SECRET` to the request itself — no extra configuration.

### GitHub Actions (5-minute ticks on the free tier)

`.github/workflows/cron-tick.yml` ticks every 5 minutes at no cost on any Vercel
plan. To use it:

1. In your cloned repo, open **Settings → Secrets and variables → Actions**.
2. Add `APP_URL` (your deployment's URL, no trailing slash) and `CRON_SECRET`
   (the same value you gave Vercel).
3. Open the **Actions** tab and enable workflows if GitHub is asking.

If you use this, drop the `crons` block from `vercel.json` to avoid a redundant
daily tick.

## 5. Optional: event triggers

Cron answers "every weekday at 8". Composio event triggers answer "whenever this
actually happens" — a new email, an issue assigned, a Slack mention. They need
Composio to reach your deployment by webhook:

1. In the Composio dashboard, copy the webhook signing secret.
2. Set `COMPOSIO_WEBHOOK_SECRET` in your Vercel project's environment variables.
3. Redeploy.

The webhook URL registers itself against your deployment's domain.

## What this costs

- **Vercel** — Hobby is free and sufficient, with the once-a-day cron caveat above.
- **Neon** — the free tier is ample for a personal instance.
- **Composio** — free tier covers personal use; check their current limits.
- **Models** — billed to whichever provider key each user enters. Clockwork
  itself adds nothing.

## Running it locally instead

See the Docker section in [README.md](./README.md) — the compose stack replaces
Vercel, Neon, and the scheduler with local containers.

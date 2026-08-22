# 15 — CD + the daily digest

## What problem it solves

**CD** is the other half of CI. CI proves the commit is good; CD gets it to users without
a human running commands on a server at midnight.

Manual deployment fails in familiar ways: steps done in the wrong order, a step forgotten,
a different person doing it differently, and no record of what's actually running. The
worst symptom is that deploys become scary, so they become rare, so each one carries
months of changes and is genuinely risky — a loop that feeds itself.

Automated deploys are small, frequent, boring, and reversible.

## How it works

### CD is CI plus one gate

`.github/workflows/deploy.yml`:

```yaml
on:
  workflow_run:
    workflows: [CI]
    types: [completed]
    branches: [main]

jobs:
  deploy:
    if: github.event.workflow_run.conclusion == 'success'
```

Two conditions: **main only**, and **only if CI passed**. `workflow_run` fires whether CI
succeeded or failed, so that `if` is doing real work — without it you'd deploy red builds,
which is worse than not automating at all.

The workflow currently has `if: false` so it can't fire until you've connected a host.
Remove that when you're ready.

### Deployment vs release

Worth separating, because it's the basis of every safe rollout:

- **Deployment** — new code is running.
- **Release** — users are getting it.

Feature flags split them: deploy code with a feature off, turn it on for 1% of users,
watch, then ramp. Blue-green and canary deploys are the same idea at the infrastructure
level. Out of scope here, but it's why "deploy" and "launch" aren't synonyms.

### What has to happen on every deploy

1. **Run migrations before the new code starts.** New code assuming a column that doesn't
   exist yet crashes on boot. Most hosts have a release/pre-deploy command — put
   `npm run migrate` there.
2. **Set environment variables in the host's dashboard.** There's no `.env` in production
   (concept 07). Generate a **new** `JWT_SECRET` for production — reusing your dev one
   means anyone who ever saw it can mint tokens.
3. **Point the client at the deployed API.** `VITE_API` at build time, or the client will
   keep calling `localhost:3000`.
4. **Update `CLIENT_ORIGIN`** to the deployed frontend URL, or CORS blocks every request
   (concept 02).
5. **Health check.** `/health` (`server/index.js`) is how the host knows the process is
   alive and whether to route traffic to it.
6. **Pick one deploy trigger.** Railway's GitHub integration and `deploy.yml` both watch
   `main`; running both means two deploys racing each other. Keep the workflow — its
   `workflow_run` gate is what stops a red build from shipping, and the host integration
   has no equivalent.

### Rolling back

The fastest rollback is redeploying the previous commit — which is why small, frequent
deploys matter: less to reason about when something's wrong.

**Database migrations are the exception.** Reverting code is instant; reverting a
`drop column` doesn't bring the data back. That's why concept 06's expand/contract matters:
add the new column, backfill, deploy code using it, and only drop the old one once you're
sure. Additive changes are always safe to roll back.

## The daily digest

The scheduled job that closes the loop on "remind me what I should be doing."

`server/jobs/digest.js` builds a per-user summary:

- habits not yet done today
- events in the next 7 days
- applications sitting at "applied" for 2+ weeks with no update

```bash
node jobs/digest.js --dry-run     # print, don't send
node jobs/digest.js               # actually send
```

### Why the scheduler lives outside the app

The tempting version is `setInterval` inside the web server. Three problems:

1. **It fires once per running instance.** Two servers means everyone gets two emails.
2. **It dies with the process** and silently doesn't run after a restart.
3. **You can't run it manually** when you need to debug it.

A standalone script triggered by an external scheduler — your host's cron, or GitHub
Actions `schedule` — fixes all three. Same code path whether it's cron or you.

### Failure isolation

```js
try { await send(user.email, body); }
catch (err) { console.error(`failed for ${user.email}: ${err.message}`); }
```

One bad address must not stop everyone else's mail. Concept 09's rule applied to a batch
job: an error in one item fails that item, not the batch.

And `if (!body) continue;` — nothing to say means no email. An app that emails you
"nothing to report" every morning gets muted within a week, and then you miss the one that
mattered.

## Manual steps

### A. Deploy (when you want it public)

Railway is the least friction; Render and Fly are equivalent.

1. Push to GitHub first (concept 14).
2. **railway.app** → sign in with GitHub → **New Project** → **Deploy from GitHub repo**.
3. Add a **PostgreSQL** service. Railway sets `DATABASE_URL` automatically.
4. Add a **Redis** service → sets `REDIS_URL`.
5. On the API service → **Variables**:
   - `JWT_SECRET` — a **new** one, not your dev value:
     `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`
   - `CLIENT_ORIGIN` — your deployed frontend URL. Comma-separated if you have both a
     host URL and a custom domain; naming only one silently CORS-blocks the other.
   - `APP_URL` — same URL, used to build the links inside emails. Deliberately not
     derived from the request: a reset link built from a `Host` header is a reset link an
     attacker can aim at their own server.
   - `NODE_ENV=production`
   - `MAIL_FROM` — an address at a domain you've verified in Resend (concept 17)
   - `AI_MONTHLY_CAP` — free AI reviews per user per month. Signups are open, so this
     is what stands between one enthusiastic user and your Anthropic bill.
   - `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_ID`,
     `AI_CREDITS_PER_PURCHASE` — optional, to sell review credit packs (concept 17).
     Add the production webhook endpoint (`/api/billing/webhook`) in the Stripe
     dashboard, pointed at the Railway URL, and use the secret it gives you.
   - `GITHUB_TOKEN` — optional (concept 07)
6. **Settings → Deploy**: root directory `server`, pre-deploy command `npm run migrate`.
7. Frontend: Vercel or Netlify, root `client`, build `npm run build`, output `dist`, and
   set `VITE_API` to `https://your-api.up.railway.app/api`.
8. Come back and set `CLIENT_ORIGIN` to the frontend URL you just got.

Then remove `if: false` from `.github/workflows/deploy.yml` and add `RAILWAY_TOKEN` under
**Settings → Secrets and variables → Actions**.

### B. Email digest

1. **resend.com** → sign up (free, no card).
2. **API Keys** → **Create API Key** → copy it.
3. `server/.env` → `RESEND_API_KEY=re_...`
4. Dry run first — always:
   ```bash
   cd server && node jobs/digest.js --dry-run
   ```
5. Then for real. On the free tier you can only send to **your own verified address**
   until you verify a domain. That is fine for one user and a hard blocker the moment
   anyone else signs up — password reset is worthless if the mail can't reach them.
   Verify a domain before opening signups (concept 17).
6. Schedule it. `.github/workflows/digest.yml` is already written and disabled — add
   `RESEND_API_KEY` and `DATABASE_URL` as repo secrets, remove its `if: false`, and it
   runs at 13:00 UTC daily. `workflow_dispatch` also lets you trigger it by hand from the
   Actions tab, which is how you'll test it.

   GitHub cron is always UTC, and scheduled runs can be delayed several minutes under
   load — fine for a daily email, not fine for anything time-critical.

## Where it lives in this repo

| What | Where |
|---|---|
| Deploy workflow, gated on CI | `.github/workflows/deploy.yml` |
| Health check | `server/index.js` |
| Digest queries | `server/jobs/digest.js` |
| Per-user failure isolation | `server/jobs/digest.js` |
| Migrations as a deploy step | `server/migrate.js` |

## Explain it in 60 seconds

> CD is the other half of CI: CI proves the commit is good, CD ships it. Ours triggers on
> a successful CI run on main — and the "successful" check matters, because the trigger
> fires on failure too, and auto-deploying red builds is worse than not automating.
>
> The reason to automate isn't speed, it's that manual deploys make deploying scary. Scary
> means rare, rare means each deploy carries months of change, which makes it genuinely
> risky. Automated deploys are small, frequent, and boring.
>
> Things that have to happen every time: run migrations before the new code starts, or new
> code hits a column that doesn't exist; set env vars in the host, since there's no `.env`
> in production; and have a health check so the platform knows whether to send traffic.
>
> Rollback is redeploying the previous commit, which is why small deploys matter. The
> exception is migrations — reverting code is instant, but reverting a dropped column
> doesn't bring the data back. So schema changes should be additive, and you drop the old
> thing in a later deploy once you're sure.
>
> The digest is a scheduled job rather than a `setInterval` in the server, for three
> reasons: an interval fires once per instance so two servers means two emails, it dies
> with the process, and you can't run it by hand to debug. External scheduler, standalone
> script, same code path either way.

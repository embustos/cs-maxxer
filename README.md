# cs maxxer

A tracker for CS students: stay on top of what the job market expects — LeetCode
consistency, networking, internship applications, side-project commits, and the club
meetings and career fairs that are easy to miss.

Built as a vehicle for learning backend engineering end to end. Every concept below is
implemented here rather than described, and the reasoning lives in comments next to the
code. **[The 17 concept docs](docs/)** are the most useful part of this repo — each one
is written after its code landed, so every reference points at something that runs.

## Features

- **Habits + streaks** — daily/weekly, real streak calculation (gaps-and-islands SQL),
  and a 14-day don't-break-the-chain row
- **Section pages** — every card expands to its own URL (`/applications`, `/goals`, …)
  with the full history: closed applications grouped by stage, past events, reached goals
- **Applications** — company, role, stage from applied → OA → interview → offer
- **Connections + outreach** — who you've met, what you sent, when to follow up
- **AI review** — Claude critiques an outreach draft or a résumé against a target role,
  with a free monthly allowance and paid credit packs through Stripe Checkout
- **Interview prep** — behavioural answers you write once and refine
- **Events + deadlines** — club meetings, career fairs, conferences
- **Goals** — progress against a target and a date
- **GitHub activity** — real commit data, cached, with graceful degradation
- **Weekly review** — a momentum score and one concrete thing to fix next week
- **Daily digest** — optional email of what's due and what's slipping

## Running it

Requires Docker and Node 22+.

```bash
docker compose up -d                  # Postgres :5433, Redis :6379

cd server
cp .env.example .env                  # then set JWT_SECRET (command is in the file)
npm install && npm run migrate
npm run dev                           # :3000

cd ../client
npm install && npm run dev            # :5173
```

Open http://localhost:5173 and create an account. Everything except AI review and email
works with no API keys at all.

```bash
cd server && npm test                 # 73 tests, needs the containers running
docker compose down -v                # wipe everything and start over
```

## Layout

```
server/
  index.js          route table, middleware chain, error handler
  config.js         every env var, validated at startup
  db.js             Postgres pool
  cache.js          Redis, cache-aside
  github.js         upstream API: timeout, retry, backoff, fallback
  ai.js             the one place this app talks to Claude
  email.js          the one place it sends mail
  tokens.js         single-use, expiring, emailed tokens
  schemas.js        zod schemas — the trust boundary
  migrate.js        migration runner
  migrations/       numbered, append-only SQL
  middleware/       auth, validate, rateLimit, aiQuota, logger
  routes/           auth, bootstrap, billing, habits, applications, events,
                    goals, github, connections, ai, onboarding, interviews, review
  jobs/digest.js    scheduled email digest
client/
  src/api.ts        the one place the token is attached
  src/App.tsx       auth gate
  src/pages/        Login, Dashboard, Onboarding, EmailAction, and the feature panels
```

## Stack, and why

Postgres and Redis in Docker, Express 5, React + Vite + TypeScript, raw `pg` (no ORM —
the SQL is the point), Tailwind, zod for validation, `node --test` for tests, GitHub
Actions for CI.

Deliberate simplifications are marked `ponytail:` in the source, each naming its ceiling
and the upgrade path:

```bash
grep -rn "ponytail:" server client --include='*.ts*' --include='*.js' --include='*.css'
```

## A couple of things worth reading

**[16 — Measuring performance](docs/16-performance.md).** A "the app is slow" report where
measuring proved the app was mostly innocent — and exposed two real defects anyway. Login
went from 18 requests to 4. Includes the two measurements that turned out to be lying.

**[17 — Opening signups](docs/17-public-accounts.md).** What changes when strangers can
create accounts: password reset, email verification, not answering "does this account
exist?", and capping spend somewhere a restart can't reset it.

**[The bug list](docs/#bugs-found-while-building-this).** Every real bug found while
building this, written up where it belongs. A UTC date that made habits look unchecked
after 5pm Pacific, a `.partial()` that silently reset fields on edit, and a React
StrictMode double-invoke that spent a single-use token twice.

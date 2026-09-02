# cs maxxer

[![CI](https://github.com/embustos/cs-maxxer/actions/workflows/ci.yml/badge.svg)](https://github.com/embustos/cs-maxxer/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)

A tracker for CS students: stay on top of what the job market expects — LeetCode
consistency, networking, internship applications, side-project commits, and the club
meetings and career fairs that are easy to miss.

Full-stack: Express 5 + Postgres + Redis behind a React 19 + TypeScript client, with
Claude for the AI reviews and Stripe for credits. No ORM — the SQL is the point.

## Screenshots

|                                            |                                                          |
| ------------------------------------------ | -------------------------------------------------------- |
| ![Login](screenshots/1-login.jpg)          | ![Dashboard](screenshots/2-dashboard-momentum.jpg)        |
| ![Habits](screenshots/3-habits-applications.jpg) | ![Connections](screenshots/4-connections-prep.jpg) |

## Features

- **Habits + streaks** — daily/weekly, real streak calculation (gaps-and-islands SQL),
  and a 14-day don't-break-the-chain row
- **Applications** — a drag-and-drop board, one column per stage (applied → OA →
  interview → offer → rejected → ghosted). Every tile opens a detail panel holding what
  you actually need when a recruiter finally replies: company size, location, how you
  found the role, requirements, recruiter and referral contacts, documents, notes
- **Connections + outreach** — who you've met, what you sent, when to follow up
- **AI review** — Claude critiques an outreach draft or a résumé against a target role,
  with a free monthly allowance and paid credit packs through Stripe Checkout
- **Interview prep** — behavioural answers in STAR form, written once and refined
- **Events + deadlines** — club meetings, career fairs, multi-day conferences
- **Goals** — progress against a target and an optional date
- **GitHub activity** — real commit data, cached, with graceful degradation
- **Weekly review** — a momentum score and one concrete thing to fix next week
- **Daily digest** — optional email of what's due and what's slipping
- **Section pages** — a persistent nav rail, and every card expands to its own URL
  (`/applications`, `/goals`, …) with the full history: closed applications grouped by
  stage, past events, reached goals

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
cd server && npm test                 # 90 tests, needs the containers running
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
  migrations/       19 numbered, append-only SQL files
  middleware/       auth, validate, rateLimit, aiQuota, logger
  routes/           auth, bootstrap, billing, habits, applications, events,
                    goals, github, connections, ai, onboarding, interviews, review
                    _crud.js — the CRUD routes shared by applications, events and
                    goals, so `user_id` is enforced once instead of three times
  jobs/digest.js    scheduled email digest
client/
  src/api.ts        the one place the token is attached
  src/App.tsx       auth gate
  src/lib/          nav links and stage labels — shared so a section can't be named
                    one thing in the sidebar and another in its heading
  src/components/   SideNav, ApplicationDetail, and the reusable pieces
  src/pages/        Login, Dashboard, Onboarding, EmailAction, and the feature panels
```

## Stack, and why

Postgres and Redis in Docker, Express 5, React 19 + Vite + TypeScript, raw `pg` (no ORM —
the SQL is the point), Tailwind v4 CSS-first tokens, zod for validation, `node --test`
for tests, GitHub Actions for CI.

A few decisions worth the words:

- **No ORM.** Streaks are a gaps-and-islands query and the weekly review is an aggregate
  over five tables. Both are clearer as SQL than as an ORM's approximation of SQL.
- **One bootstrap request.** The dashboard needs seven collections; seven parallel
  fetches still queue behind the browser's six-per-origin cap and re-pay the round trip
  each time. `GET /api/bootstrap` returns all of it, running the same list query the
  individual routes do rather than a second copy of each.
- **Native platform features first.** The detail panel is a `<dialog>` opened with
  `showModal()` — focus trap, Escape, focus return and top-layer stacking come from the
  browser. The board is HTML5 drag-and-drop with a keyboard-and-screen-reader path
  beside it, because drag alone reaches neither.
- **The migration runner is one 50-line file**, not a dependency: numbered `.sql` files,
  applied once, in order, each inside a transaction, recorded in a table.

Deliberate simplifications are marked `ponytail:` in the source, each naming its ceiling
and the upgrade path:

```bash
grep -rn "ponytail:" server client --include='*.ts*' --include='*.js' --include='*.css'
```

## Deploying

CI runs on every push and pull request against a fresh Postgres and Redis. Deployment is
a separate workflow that waits for CI to go green and only ever runs from `main` — it is
inert until you set two things in **Settings → Secrets and variables → Actions**:

| Kind     | Name             | Value                    |
| -------- | ---------------- | ------------------------ |
| Secret   | `RAILWAY_TOKEN`  | your Railway token       |
| Variable | `DEPLOY_ENABLED` | `true`                   |

A repo variable rather than a commented-out line, so turning deploys off during an
incident is a click instead of a push — and pushing to disable deploys is exactly the
thing that doesn't work when deploys are what's broken. Turn off Railway's own git
integration when you enable this, or two triggers race on every merge.

Run `npm run migrate` against the production database before the new server boots. The
API selects columns the migration adds, so the wrong order gives you a 500 on
`/api/bootstrap` rather than a clean failure.

## License

MIT — see [LICENSE](LICENSE).

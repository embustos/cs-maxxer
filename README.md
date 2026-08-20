# cs-tracker

A tracker for CS students: stay on top of what the job market expects — LeetCode
consistency, networking, internship applications, side-project commits, and the club
meetings and career fairs that are easy to miss.

Built as a vehicle for learning backend engineering end to end — HTTP and REST, auth,
SQL and indexes, migrations, secrets, validation, error handling, caching, rate limiting,
structured logging, testing, and CI/CD. Each of those is implemented here rather than
described, and the reasoning lives in comments next to the code.

## Features

- **Habits + streaks** — daily/weekly, with a real streak calculation (gaps-and-islands SQL)
- **Applications** — company, role, stage from applied → OA → interview → offer
- **Events + deadlines** — club meetings, career fairs, conferences
- **Goals** — progress against a target and a date
- **GitHub activity** — real commit data, cached, with graceful degradation
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

Open http://localhost:5173 and create an account.

```bash
cd server && npm test                 # 24 tests, needs the containers running
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
  schemas.js        zod schemas — the trust boundary
  migrate.js        migration runner
  migrations/       numbered, append-only SQL
  middleware/       auth, validate, rateLimit, logger
  routes/           auth, habits, applications, events, goals, github
  jobs/digest.js    scheduled email digest
client/
  src/api.js        the one place the token is attached
  src/App.jsx       auth gate
  src/pages/        Login, Dashboard, Applications, Events, Goals, GitHub
```

## Stack, and why

Postgres and Redis in Docker, Express 5, React + Vite, raw `pg` (no ORM — the SQL is the
point), zod for validation, `node --test` for tests, GitHub Actions for CI.

Deliberate simplifications are marked `ponytail:` in the source, each naming its ceiling
and the upgrade path. `grep -rn "ponytail:" server client --include='*.js*'`

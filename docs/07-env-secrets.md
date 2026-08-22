# 07 — Env + secrets

## What problem it solves

Two different problems, often confused:

1. **Configuration changes between environments.** Your laptop's database is not
   production's. Hardcoding either means editing code to deploy — and eventually shipping
   a build that points at the wrong one.
2. **Some configuration is a secret.** A hardcoded `JWT_SECRET` is in your git history
   forever, visible to everyone with repo access, and mints valid tokens for any account.

Secrets leak through git constantly. GitHub scans public pushes and revokes found keys
automatically — that's how common this is. And `git rm` doesn't help: the value is in
history. A leaked secret must be **rotated**, not deleted.

## How it works

Config lives in **environment variables** — key-value pairs the OS hands the process.
Same code, different values, nothing secret on disk in the repo.

Locally, `dotenv` loads `server/.env` into `process.env`. In production, the host
(Railway, Render, Fly) injects them directly; there's no `.env` file at all.

Three files, and the distinction is the whole concept:

| File | Committed? | Contains |
|---|---|---|
| `.env` | **never** — gitignored | real values |
| `.env.example` | yes | the *keys*, with empty values and instructions |
| `.gitignore` | yes | the line `.env` that keeps it out |

`.env.example` is what makes a repo cloneable: a new person copies it, fills it in, and
knows exactly what's needed without anyone leaking anything.

### Read env vars in exactly one place

`server/config.js`. Every other module imports that. Two payoffs:

**Fail fast at startup, not at 2am.** `server/config.js:9`:

```js
function required(name) {
  const value = process.env[name];
  if (!value) {
    console.error(`\nMissing required env var: ${name}\nCopy .env.example to .env...`);
    process.exit(1);
  }
  return value;
}
```

Without this, a missing `JWT_SECRET` means `jwt.sign(payload, undefined)` — which throws
on the first login attempt, in production, at whatever hour that happens. Crashing on boot
turns a mysterious runtime failure into an obvious deploy failure.

**One place to answer "what does this app need?"** Scattered `process.env` reads mean
grepping to find out. You can verify the discipline holds:

```bash
grep -rn "process\.env" server --include='*.js' | grep -v node_modules | grep -v config.js
```

Only `config.js` (and one test that deliberately sets a value) should appear.

### Required vs optional

Not every variable is mandatory, and pretending otherwise makes an app annoying to run:

```js
jwtSecret: required('JWT_SECRET'),                       // no app without it
databaseUrl: required('DATABASE_URL'),                   // no app without it
redisUrl: process.env.REDIS_URL ?? 'redis://localhost:6379',   // sane default
githubToken: process.env.GITHUB_TOKEN ?? null,           // feature degrades, app runs
```

The GitHub token is genuinely optional: without it the API allows 60 requests/hour per IP,
with it 5,000/hour. The feature works either way. **A cache in front of it (concept 10) is
what makes the unauthenticated limit survivable.**

There's also an environment-specific check at `server/config.js:34` — a short secret is
tolerable locally and fatal in production.

### Secrets that reach the browser

Critical, and covered in concept 02: **anything in `client/` is public.** Vite inlines
`VITE_*` variables into the bundle at build time. `VITE_API_URL` is fine. A `VITE_`
anything-secret is a published secret. If the browser can use it, the user can read it.

The rule: secrets belong to the server. If the browser needs data that requires a secret,
the browser asks the server, and the server uses the secret. That's exactly what
`/api/github/activity` does — the token never leaves the machine.

## Where it lives in this repo

| What | Where |
|---|---|
| Every env var, read once | `server/config.js` |
| Fail-fast validator | `server/config.js:9` |
| Production-only strength check | `server/config.js:34` |
| The template you commit | `server/.env.example` |
| The file you never commit | `.gitignore` |
| CI's throwaway secrets | `.github/workflows/ci.yml` |
| Secret used, server-side only | `server/github.js:25` |

Note the CI values are deliberately fake — a CI secret should never be a production one,
because logs and forked PRs leak more than you'd like.

## Manual step: your GitHub token (optional)

The app works without it. Do this when you hit the 60/hour limit:

1. github.com → your avatar → **Settings**
2. Bottom left → **Developer settings**
3. **Personal access tokens** → **Fine-grained tokens** → **Generate new token**
4. Name it `cs-tracker`, expiry 90 days
5. Repository access: **Public repositories (read-only)** — it needs no other scopes,
   because we only read public event data
6. Generate, copy it (**shown once**)
7. Paste into `server/.env` as `GITHUB_TOKEN=github_pat_...`
8. Restart the server

If you ever paste a token into a chat, a screenshot, or a commit: **delete it on GitHub
and generate a new one.** Rotation is the only real remediation.

## Try it yourself

```bash
cd server

# fail-fast in action
JWT_SECRET= node -e "require('./config')"     # exits with a clear message

# confirm .env is not tracked
git check-ignore -v .env

# see what the app needs, without any secrets
cat .env.example
```

## Explain it in 60 seconds

> Configuration that changes between environments — database URLs, ports — and anything
> secret both live in environment variables rather than in code. Locally that's a `.env`
> file that's gitignored; in production the host injects them, and there's no file at all.
>
> You commit a `.env.example` with the keys and no values, so someone cloning the repo
> knows what to set without you leaking anything.
>
> Two practices matter. First, read env vars in exactly one module and validate them at
> startup — a missing secret should crash the app on boot with a clear message, not throw
> at 2am on the one route that needed it. Second, distinguish required from optional: our
> GitHub token is optional and just lowers a rate limit, so the app still runs without it.
>
> And the rule that catches people: anything bundled into frontend code is public. Vite
> inlines `VITE_` variables straight into the JavaScript you ship. Secrets stay on the
> server — if the browser needs something that requires one, it asks the server, and the
> server holds the secret.
>
> If a secret does leak, deleting the commit isn't enough. It's in history. You rotate it.

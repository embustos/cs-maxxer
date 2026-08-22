# 12 — Logging + observability

## What problem it solves

Something breaks in production. You can't attach a debugger, you can't reproduce it, and
the user's report is "it didn't work this morning." Logs are the only record of what
actually happened.

The instinct is:

```js
console.log('user ' + userId + ' updated habit ' + habitId);
```

Readable for one line. Useless at ten thousand, because you cannot **query** it. You can't
ask "how many 500s in the last hour, grouped by endpoint" without writing a regex against
prose you'll get wrong.

## How it works

### Structured logs: one JSON object per line

`server/middleware/logger.js:11`:

```js
const log = (fields) => console.log(JSON.stringify({ time: ..., ...fields }));
```

Output:

```json
{"time":"2026-08-18T22:39:51.732Z","level":"warn","msg":"request","id":"06322437-…","method":"POST","path":"/api/auth/login","status":429,"ms":0.2,"user":null}
```

Less pleasant to read; **infinitely** more useful. Every aggregator — Datadog, CloudWatch,
Loki, Splunk — parses JSON lines for free, and then you can ask real questions:

```
level=error | count by path
status>=500 | count by path            ← which endpoint is broken
ms>1000 | count by path                ← what's slow
user=42 | sort by time                 ← everything one person did
```

Locally, `jq` does the same: `npm run dev | jq 'select(.status >= 400)'`.

### Request IDs: the thing that makes logs usable

`server/middleware/logger.js:15`:

```js
req.id = req.headers['x-request-id'] ?? crypto.randomUUID();
res.set('X-Request-Id', req.id);
```

Every log line for one request carries the same id. Three payoffs:

1. **Correlation.** One request producing five log lines interleaved with a hundred other
   concurrent requests can still be reassembled in order.
2. **The user can hand it to you.** Our 500 response includes it
   (`server/index.js:40`), so "it broke, id `06322437`" turns a vague report into
   `grep 06322437` and the exact stack trace.
3. **It crosses services.** We honor an incoming `X-Request-Id`, so a request keeps its
   identity through every service it touches — that's **distributed tracing** in miniature.

### Log after the response, not before

```js
res.on('finish', () => { ...log... });
```

`finish` fires once the response is fully sent — which is the only moment the status code
and the duration are real. Logging on the way in gets you neither.

Duration uses `process.hrtime.bigint()`, a monotonic clock. `Date.now()` can jump
backwards when NTP adjusts, producing negative durations.

### Group by route, not by URL

```js
path: req.baseUrl + (req.route ? req.route.path : req.path),
```

`req.route.path` is the **pattern** — `/api/habits/:id`, not `/api/habits/318`. Logging
concrete URLs scatters one endpoint across every id ever requested, so "which endpoint is
slow" becomes unanswerable.

This line had a bug worth keeping: it originally fell back to bare `req.path`, which
inside a mounted router is **relative to the mount point**. A rate-limited login logged as
`/login` instead of `/api/auth/login` — the prefix silently dropped, exactly for the
requests you most want to investigate. **A log that lies is worse than no log.**

### Levels, and what belongs at each

```js
level: res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info',
```

- **error** — we broke. Should page someone.
- **warn** — the client did something wrong (400, 401, 429). Expected; a spike is a signal.
- **info** — normal operation.
- **debug** — off in production.

The 4xx/5xx split (concept 01) pays off here: it's the difference between "someone typed a
bad password" and "our code threw."

### What must never be logged

- **Passwords**, even hashed, even on failure.
- **Tokens** — a logged JWT is a working credential for anyone with log access.
- **Full request bodies** — they contain the above.
- **PII beyond what you need** — we log `user: 42`, not the email. The id joins to the
  user when you need it.

Logs get shipped to third parties, retained for years, and read by more people than you'd
expect. **Anything sensitive in a log is now sensitive in five more systems.**

### Observability beyond logs

Logs are one of three pillars:

- **Logs** — discrete events. "What happened?"
- **Metrics** — aggregated numbers over time. "How many, how fast, right now?"
- **Traces** — one request's path across services. "Where did the time go?"

Our request log carries `status` and `ms`, so basic metrics can be derived from it — a
completely reasonable stopping point at this size. The `/health` endpoint
(`server/index.js:23`) is the other half: hosts poll it to decide whether the process is
alive and whether to route traffic to it.

## Where it lives in this repo

| What | Where |
|---|---|
| Structured emitter | `server/middleware/logger.js:11` |
| Request id, honored or generated | `server/middleware/logger.js:15` |
| Log on `finish` | `server/middleware/logger.js:20` |
| Route pattern, not concrete URL | `server/middleware/logger.js:32` |
| Level from status | `server/middleware/logger.js:23` |
| Id returned to the client on 500 | `server/index.js:40` |
| Health check | `server/index.js:23` |
| Redis errors logged, not thrown | `server/cache.js:14` |

## Try it yourself

```bash
cd server && npm run dev
```

In another terminal, generate some traffic, then filter it:

```bash
curl -s localhost:3000/api/habits > /dev/null                     # 401
curl -s localhost:3000/health > /dev/null                         # 200

# grab the request id off a response
curl -si localhost:3000/health | grep -i x-request-id
```

With `jq`, ask real questions of the stream:

```bash
npm run dev 2>&1 | jq -c 'select(.status >= 400) | {path, status, ms}'
npm run dev 2>&1 | jq -c 'select(.ms > 100)'
```

## Explain it in 60 seconds

> In production you can't attach a debugger, so logs are the only record of what happened.
> The key move is making them structured — one JSON object per line instead of a sentence.
> Prose is readable at one line and unqueryable at ten thousand; JSON lets every log tool
> answer "how many 500s in the last hour, grouped by endpoint" directly.
>
> The second key move is a request id. Every line for one request carries the same id, so
> you can reassemble a single request out of thousands of interleaved ones. We return it
> in error responses too, so a user reporting a bug can quote it and you go straight to the
> stack trace. And we honor an incoming one, so the id survives across services — that's
> the basis of distributed tracing.
>
> Details that matter: log on response finish, because that's when status and duration
> exist; group by route pattern, not the concrete URL, or one endpoint scatters across
> every id; and never log passwords, tokens, or full bodies — logs get shipped to third
> parties and kept for years, so anything sensitive in a log is now sensitive in five more
> places.
>
> We had a real bug here where the log recorded `/login` instead of `/api/auth/login`,
> because inside a mounted router the path is relative to the mount point. A log that lies
> about which endpoint was hit is worse than no log at all.

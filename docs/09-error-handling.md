# 09 — Error handling

## What problem it solves

Your own code is predictable. The moment you call **someone else's server**, you inherit
every way their day can go wrong: slow, down, rate-limiting you, returning a 500, or
returning a 200 with a shape you didn't expect.

The naive version:

```js
const res = await fetch('https://api.github.com/users/x/events/public');
const data = await res.json();
```

Three failure modes, all silent:

1. **No timeout.** If GitHub hangs, this waits — potentially minutes. Meanwhile that
   request holds a connection in your server. Enough of them and *your* service is down
   because *theirs* was slow. This is how one dependency takes out a healthy system.
2. **No status check.** `res.json()` on a 404 parses GitHub's error body into `data`,
   and now `data.total` is `undefined` flowing into your app as if it were real.
3. **No retry.** A blip that would have succeeded 200ms later becomes a user-visible error.

## How it works

Four techniques, in `server/github.js`, in the order they matter.

### 1. Timeout — always

```js
const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });   // 5s
```

Node 18+ gives this for free. **Every outbound call needs one.** Pick a number: how long
before waiting longer is worse than failing? For a dashboard widget, 5 seconds.

### 2. Retry — but only what retrying can fix

```js
const retryable = err.name === 'TimeoutError' || err.status === 502 || err.status >= 500;
if (!retryable || i >= attempts) throw err;
```

A 404 will be a 404 forever; retrying wastes your rate limit and delays the error. A 401
won't fix itself. **Timeouts and 5xx are worth another attempt; 4xx are not.**

Retries are also only safe for **idempotent** operations (concept 01). Retrying a `GET` is
free. Retrying a `POST` that already succeeded creates a second record — the response was
lost, not the action.

### 3. Backoff — don't pile on

```js
await new Promise((r) => setTimeout(r, 2 ** i * 100));   // 200ms, then 400ms
```

Retrying instantly hammers a service that's already struggling. Exponential backoff gives
it room. At scale you'd add **jitter** (a random fraction) so that a thousand clients
that failed together don't retry in lockstep and re-crash it — a "thundering herd."

### 4. Fallback — degrade, don't die

`server/github.js:89`:

```js
try {
  return await cache.remember(key, CACHE_TTL, ...);
} catch (err) {
  const stale = await cache.get(`${key}:stale`);
  if (stale) return { ...stale, cached: true, stale: true, error: err.message };
  throw err;
}
```

We keep a week-long copy purely as a fallback. If GitHub is down, the dashboard shows
yesterday's number **labelled stale** instead of an error. A slightly old number beats a
broken page — and the label matters, because silently serving stale data as fresh is its
own bug. The UI surfaces it (`client/src/pages/GitHub.tsx`).

### Whose fault is it? 4xx vs 5xx vs 502

`server/routes/github.js:41`:

```js
if (err.status) return res.status(err.status === 404 ? 404 : 502).json({ error: err.message });
next(err);   // genuinely ours → 500
```

- **404** — the user typed a GitHub username that doesn't exist. Their input, their fix.
- **502 Bad Gateway** — the literal meaning: *we* are a gateway and the thing *upstream*
  failed. Not our bug, and not something the user can fix by retrying immediately.
- **500** — our unhandled bug, and it should page someone.

Collapsing all three into 500 destroys your ability to tell "GitHub is down" from "we
shipped a bug" — which is exactly the question you need answered during an incident.

### The global net

`server/index.js:36`, an express error handler (four arguments — that's the signal):

```js
app.use((err, req, res, next) => {
  log({ level: 'error', msg: 'unhandled', id: req.id, err: err.message, stack: err.stack });
  res.status(500).json({ error: 'internal server error', request_id: req.id });
});
```

Two deliberate choices:

- **The full error goes to the logs; the client gets a generic message.** Stack traces and
  SQL text are a map of your internals — that's reconnaissance for an attacker.
- **The client gets a `request_id`.** The user quotes it, you grep the logs, you have the
  exact request. That's the bridge between "it broke" and a stack trace (concept 12).

Express 5 forwards rejected promises from async handlers here automatically. In Express 4
an unhandled async rejection would crash the process.

### The cache as an error-handling device

`server/cache.js` swallows every Redis failure and returns `null`. A cache is an
**optimization**: if it's down, the app must still work, just slower. Making a cache
failure a request failure means adding a dependency that can take you down — the opposite
of the reliability you added it for.

## Where it lives in this repo

| What | Where |
|---|---|
| Timeout on every outbound call | `server/github.js:21` |
| Retry only what's retryable | `server/github.js:47` |
| Exponential backoff | `server/github.js:54` |
| Stale fallback | `server/github.js:89` |
| 404 vs 502 vs 500 | `server/routes/github.js:41` |
| Global handler, generic message | `server/index.js:36` |
| Cache failures swallowed | `server/cache.js:24` |
| Stale shown in the UI | `client/src/pages/GitHub.tsx` |
| Per-user error, not a dead page | `client/src/pages/Dashboard.tsx` |

## Try it yourself

```bash
# 404 from upstream, surfaced as 404 not 500
TOKEN=...
curl -s -X PUT localhost:3000/api/github/username -H 'content-type: application/json' \
  -H "Authorization: Bearer $TOKEN" -d '{"username":"this-user-does-not-exist-9999"}'
curl -s localhost:3000/api/github/activity -H "Authorization: Bearer $TOKEN"
```

To watch the fallback work, take Redis down mid-flight:

```bash
docker compose stop redis
curl -s localhost:3000/api/github/activity -H "Authorization: Bearer $TOKEN"   # still 200, just slower
docker compose start redis
```

And to see a timeout, drop `TIMEOUT_MS` in `server/github.js` to `1` and watch the retries
fire before it gives up.

## Explain it in 60 seconds

> The moment you call someone else's API you inherit all their failure modes. Four things
> handle that.
>
> Timeouts, always — without one, a hung upstream holds your connections open until your
> own service stops answering anyone. One slow dependency taking down a healthy system is
> the classic cascading failure.
>
> Retries, but only for things retrying can fix: timeouts and 5xx, never a 404 or a 401.
> And only for idempotent operations — retrying a POST that actually succeeded creates a
> duplicate.
>
> Backoff, so you don't hammer something that's already struggling. Exponential, plus
> jitter at scale so clients don't retry in lockstep.
>
> And a fallback: we keep a week-old cached copy and serve it labelled "stale" if GitHub
> is down. A slightly old number beats a broken page, as long as you say it's old.
>
> The other half is status codes. An upstream failure is a 502, not a 500 — 502 literally
> means the thing behind us failed. If you collapse everything into 500 you can't tell
> "GitHub is down" from "we shipped a bug", which is the exact question you need during an
> incident. And the client gets a generic message plus a request id, never a stack trace —
> that's internal reconnaissance you don't hand out.

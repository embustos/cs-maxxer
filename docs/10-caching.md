# 10 — Caching

## What problem it solves

The GitHub call takes ~870ms. Every dashboard load would spend most of a second waiting,
and every refresh burns one of your 60 requests/hour on data that changes maybe once a day.

With a cache in front:

```
cold (calls GitHub):   869 ms
warm (from Redis):       1 ms
```

**~870× faster**, measured in this repo. And the rate limit stops being a problem: one
upstream call per user per 15 minutes, however often they refresh.

Caching is the standard answer to "this is slow" — and the standard source of "why is it
showing old data?" Both come from the same tradeoff.

## How it works

The pattern is three steps, and it's called **cache-aside** (or lazy loading):

1. Look in the cache. Hit → return it.
2. Miss → do the expensive thing.
3. Store the result with an expiry, then return it.

`server/cache.js:46`:

```js
async function remember(key, ttlSeconds, produce) {
  const hit = await get(key);
  if (hit !== null) return { ...hit, cached: true };
  const fresh = await produce();
  await set(key, fresh, ttlSeconds);
  return { ...fresh, cached: false };
}
```

Callers don't write cache logic; they say what to compute and how long it stays valid.

### Why Redis and not a Map

A `Map` in your process would be faster still and needs no dependency. It fails in two
ways that matter:

- **It dies on restart.** Every deploy starts cold. Deploy during peak and every request
  stampedes your database at once.
- **It isn't shared.** Run two servers behind a load balancer and you have two half-cold
  caches, double the upstream calls, and users seeing different data depending on which
  machine answered.

Redis is a separate process holding one cache all your servers share, surviving deploys.
That's the entire reason it exists. (For genuinely process-local, never-stale data — a
compiled regex, a config file — a Map is correct and Redis is overkill.)

### Invalidation: the hard part, made easy

> "There are only two hard things in Computer Science: cache invalidation and naming
> things." — Phil Karlton

Cached data is a **copy**. The moment the source changes, your copy is a lie. The
strategies, worst to best for our case:

- **Manual invalidation** — delete the key when the source changes. Exact, but you must
  find *every* write path. Miss one and it's stale forever. Fine for data *you* own.
- **Write-through** — update cache and source together. Same problem, more coupling.
- **TTL (what we use)** — the entry expires on its own. Data can be wrong for at most N
  seconds, and it is guaranteed to self-correct.

TTL wins here because **we don't own the data**. GitHub never tells us when you push, so
there is no event to invalidate on. 15 minutes says: *this may be up to 15 minutes stale,
and we accept that.* Stating the staleness budget out loud is the whole design decision.

We do use manual invalidation where we own the data — changing your GitHub username
writes a new key, so the old one is simply never read again.

### Choosing a TTL

Ask: **how wrong can this be before someone is annoyed?**

| Data | Reasonable TTL | Why |
|---|---|---|
| GitHub commit counts | 15 min | changes daily at most |
| A user's own habits | none | they just changed it; stale is unacceptable |
| Public leaderboard | 1–5 min | approximate is fine |
| Auth tokens/permissions | none or seconds | stale permissions are a security bug |

Notice most of this app is **not cached**. Your habits come straight from Postgres, which
answers in under a millisecond with the right index (concept 04). Caching them would add
staleness to fix a problem that doesn't exist. **Cache the slow, shared, tolerably-stale
thing — not everything.**

### A cache must never be able to break you

Every function in `server/cache.js` swallows its errors and returns `null`:

```js
async function get(key) {
  try { ... } catch { return null; }   // a broken cache is an empty cache
}
```

If Redis is down, every lookup misses, everything is slower, and **the app keeps working**.
The alternative — a cache failure becoming a request failure — means you added a component
that can take down a system that used to work without it.

### Two more failure modes worth naming

- **Stampede / thundering herd.** When a hot key expires, every concurrent request misses
  at once and all of them call upstream. At our scale, irrelevant. At scale, you add a
  lock so one request refreshes while others serve the old value.
- **Key collisions.** Keys are namespaced (`github:commits:torvalds`). Two features using
  the key `user:1` for different shapes is a genuinely confusing bug.

The `:stale` key from concept 09 is a second, week-long copy used only as a fallback —
caching serving reliability rather than speed.

## Where it lives in this repo

| What | Where |
|---|---|
| The cache-aside helper | `server/cache.js:46` |
| Failures swallowed | `server/cache.js:24`, `:34` |
| 15-minute TTL chosen | `server/github.js:7` |
| Used, plus the stale copy | `server/github.js:89` |
| `cached` / `stale` shown to the user | `client/src/pages/GitHub.tsx` |
| Redis container | `docker-compose.yml` |

Surfacing `cached: true` in the API response is deliberate — during debugging, "is this
cached?" is the first question, and guessing wastes time.

## Try it yourself

```bash
cd server && node -e "
const c = require('./cache'); const { getCommitActivity } = require('./github');
c.connect().then(async () => {
  await c.del('github:commits:torvalds');
  let t = Date.now(); let r = await getCommitActivity('torvalds');
  console.log('cold:', Date.now() - t + 'ms', 'cached=' + r.cached);
  t = Date.now(); r = await getCommitActivity('torvalds');
  console.log('warm:', Date.now() - t + 'ms', 'cached=' + r.cached);
  await c.quit(); process.exit(0);
})"
```

Then look inside Redis, and prove the app survives without it:

```bash
docker exec -it cs-tracker-redis-1 redis-cli
> keys github:*
> ttl github:commits:torvalds     # seconds remaining — watch it count down
> get github:commits:torvalds

docker compose stop redis         # app still works, just slower
docker compose start redis
```

## Explain it in 60 seconds

> A cache stores the result of something expensive so you don't redo it. Ours put a
> GitHub API call from 870 milliseconds down to 1 — and it means one upstream call per
> user every 15 minutes no matter how often they refresh, which keeps us under the rate
> limit.
>
> The pattern is cache-aside: look in the cache, and on a miss do the work and store it
> with an expiry.
>
> We use Redis rather than an in-memory Map for two reasons — a Map dies on every deploy,
> so you start cold and stampede your database, and it isn't shared, so two servers behind
> a load balancer keep two different caches and users see different data.
>
> The hard part is invalidation, because cached data is a copy and the source can change
> under it. We use a TTL, which means "this can be wrong for at most 15 minutes and then
> fixes itself." That's the right call here specifically because we don't own the data —
> GitHub never tells us when you push, so there's no event to invalidate on. Where we *do*
> own the data, like habits, we don't cache at all: Postgres answers in under a millisecond
> and staleness would be a pure downside.
>
> Last thing: a cache is an optimization, so every Redis failure is swallowed and treated
> as a miss. If the cache going down takes your app down, you've added a liability instead
> of a speedup.

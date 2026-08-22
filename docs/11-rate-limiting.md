# 11 — Rate limiting

## What problem it solves

Without a limit, one client can send as many requests as it can generate. Three concrete
consequences:

1. **Credential stuffing.** Your login accepts unlimited guesses. Attackers don't guess
   randomly — they replay leaked email/password pairs from other breaches. Unlimited
   attempts turn that into a certainty.
2. **Resource exhaustion.** bcrypt burns ~250ms of CPU *by design* (concept 03). A few
   hundred concurrent login attempts pin every core and the site stops answering everyone.
   The expensive-by-design defense becomes the attack surface.
3. **Blowing a shared budget.** GitHub allows 60 requests/hour per IP. One user hammering
   refresh spends everyone's.

Rate limiting is also just being a good citizen of somebody else's API.

## How it works

We implement a **token bucket** (`server/middleware/rateLimit.js`):

- The bucket holds `capacity` tokens and refills at `refillPerSec`.
- Each request spends one.
- Empty bucket → `429 Too Many Requests`.

```js
bucket.tokens = Math.min(capacity, bucket.tokens + ((now - bucket.last) / 1000) * refillPerSec);
if (bucket.tokens < 1) { ...429... }
bucket.tokens -= 1;
```

No background timer — refill is computed from elapsed time on each request. Exact, and
free when nobody is calling.

Two properties fall out that a naive counter lacks:

- **Bursts are allowed.** A full bucket absorbs `capacity` requests at once. Real usage is
  bursty (a dashboard fires four requests on load), and that's fine.
- **The long-run average is still capped** at the refill rate.

### Why not a fixed window

"100 requests per minute", reset on the minute, is the obvious implementation and has two
real flaws:

- **Boundary burst.** 100 requests at 12:00:59 and 100 more at 12:01:00 — 200 in one
  second, technically within limits.
- **Synchronized clients.** Everyone's window resets at the same instant, so you get a
  spike on every minute boundary. Clients that got limited retry together, and re-spike.

A **sliding window** fixes the boundary problem but needs a timestamp log per client.
Token bucket gets the same smoothness with two numbers per client, which is why it's what
most APIs actually use.

### Choosing the numbers

The limit should be invisible to real use and obstructive to abuse.

**Login** (`server/index.js:17`) — capacity 10, refill 0.2/sec (one per 5s):

> A human mistyping their password 3 times never notices. A script gets 10 tries and then
> one every 5 seconds — turning a million-guess run into ~58 days.

**GitHub** (`server/routes/github.js:13`) — capacity 10, refill 10/min, keyed per user:

> Keyed on `req.user.id`, not IP — so a whole campus behind one NAT doesn't share a
> bucket. Whenever there's an authenticated user, key on them.

### The 429 response

```js
res.set('Retry-After', String(waitSec));
return res.status(429).json({ error: message, retry_after_seconds: waitSec });
```

`429` is the correct status, and **`Retry-After` is what makes it actionable**. Without
it a client can only guess, and well-behaved clients guess badly. Telling them exactly
when to return is how you get cooperation instead of a retry storm.

### Known limits of this implementation

Marked in the source, because a shortcut you can't see is a trap:

```js
// ponytail: in-process Map. Correct for one server; each process keeps its own buckets,
// so N servers means N× the limit. Move the bucket into Redis when you run more than one.
```

Honest statement: with two servers behind a load balancer, the effective limit doubles.
For one process this is exactly right, and the upgrade path is one function swapped to use
Redis `INCR` with an expiry.

Also `server/index.js:10`:

```js
app.set('trust proxy', 1);
```

Behind a host's load balancer, every request arrives from the proxy's IP — so without
this, all users share one bucket and rate limiting either does nothing or blocks everyone.
It tells Express to read the real client IP from `X-Forwarded-For`. **Only set this when
you're actually behind a proxy you trust**, since otherwise clients can spoof that header
and evade the limit entirely.

And the sweep at `server/middleware/rateLimit.js:40`: without it the Map grows one entry
per IP forever — a slow leak that only manifests in production.

## Where it lives in this repo

| What | Where |
|---|---|
| The algorithm | `server/middleware/rateLimit.js:14` |
| Refill arithmetic | `server/middleware/rateLimit.js:22` |
| 429 + Retry-After | `server/middleware/rateLimit.js:25-31` |
| Memory sweep | `server/middleware/rateLimit.js:40` |
| Login limit | `server/index.js:17` |
| GitHub limit, keyed per user | `server/routes/github.js:13` |
| Real client IP behind a proxy | `server/index.js:10` |
| Tests | `server/ratelimit.test.js` |

## Try it yourself

```bash
for i in $(seq 1 13); do
  printf "%s " $(curl -s -o /dev/null -w '%{http_code}' -X POST localhost:3000/api/auth/login \
    -H 'content-type: application/json' -d '{"email":"a@b.com","password":"wrongpassword"}')
done; echo
# 401 401 401 401 401 401 401 401 401 401 429 429 429
```

Ten get through, then the bucket is empty. Wait five seconds and exactly one more works —
that's the refill. The `Retry-After` header tells you how long:

```bash
curl -si -X POST localhost:3000/api/auth/login -H 'content-type: application/json' \
  -d '{"email":"a@b.com","password":"x"}' | grep -i retry-after
```

## Explain it in 60 seconds

> Rate limiting caps how often one client can call you. It matters most on login: without
> it, someone can make unlimited password guesses, and because bcrypt is deliberately slow
> a few hundred concurrent attempts will also pin your CPU and take the site down for
> everyone.
>
> We use a token bucket. The bucket holds N tokens and refills at a fixed rate; each
> request spends one; empty means 429. That allows short bursts — which real usage
> genuinely has — while capping the long-run average.
>
> The alternative, a fixed window like "100 per minute", has a boundary problem: 100
> requests at 12:00:59 plus 100 at 12:01:00 is 200 in one second. It also synchronizes
> every client onto the same reset instant, so you get a spike each minute.
>
> Two details that matter in practice. Return `Retry-After` with the 429 so clients know
> exactly when to come back instead of guessing. And key on the user id when there is one,
> not the IP — otherwise everyone behind one campus NAT shares a bucket.
>
> Our implementation keeps buckets in process memory, which is correct for one server and
> means N servers gives N times the limit. That's a documented ceiling; the fix is moving
> the counter into Redis.

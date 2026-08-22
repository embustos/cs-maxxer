# 16 — Measuring performance (and the waterfall)

## What problem it solves

"The app feels slow" is not a bug report. It's a starting point, and the only way to turn
it into one is to measure — because the thing you'd guess is almost never the thing.

This doc is the write-up of a real investigation in this repo. It's here because the
process mattered more than the fix: **most of the elapsed time turned out not to be the
app's fault at all, and the app still had two genuine defects that only the measurement
exposed.**

## How it works

### Measure layer by layer, and rule things out

The report was "login and loading the dashboard takes 3–5 seconds." Rather than guessing,
each layer got timed independently:

| Layer | Measured | Verdict |
|---|---|---|
| API, 8 endpoints concurrently | 83ms via curl | not it |
| Login (`POST /api/auth/login`) | 433ms | bcrypt cost 12, deliberate |
| GitHub upstream | 585ms cold, 5ms warm | cached, not on the critical path |
| Background animation | 0.9ms/frame at 6.5M px | not it |
| Full login → dashboard | 377ms | **cannot reproduce** |

Saying "I can't reproduce it" is a result. It's what stops you from optimizing something
that was never slow.

### The measurement itself can be wrong

Two false readings had to be thrown out along the way, and both are worth knowing about:

**Timing in a hidden tab.** Every browser measurement was taken in a background tab.
`requestAnimationFrame` never fired, `document.visibilityState` was `"hidden"`, and the
animation's own pause guard was active the whole time — so the numbers described a page
that wasn't rendering.

**Cross-origin Resource Timing is zeroed.** The phase fields (`domainLookupStart`,
`responseStart`, …) come back as `0` for cross-origin requests unless the server sends
`Timing-Allow-Origin`. Reading them anyway produced nonsense like a 2907ms "download" and
a **negative** stall time. A number that can't physically be negative is a bug in your
instrument, not a finding.

### The finding: the machine, not the app

The real trace showed bcrypt taking **2716ms** where it takes 253ms on an idle machine —
10.7×. The same 10.7× applied uniformly to every operation. A uniform slowdown across
unrelated code paths is the signature of **CPU starvation**, not an application bug.

`uptime` confirmed it: load average **46** on 12 cores, and a system daemon pegged at 75%
of a core for 113 days straight.

**A profile is relative to the machine it ran on.** Numbers from a starved machine tell
you about the machine.

### The two real defects it exposed anyway

**1. Three serial round trips before any data was requested.** 63% of the elapsed time
passed before the dashboard asked for anything: login → `/auth/me` → *then* the data.
Each step had to finish before the next could start.

**2. "Parallel" fetches that weren't.** The dashboard fired eight requests at once. Chrome
allows **six connections per origin** on HTTP/1.1, so two of them sat in a queue waiting
for a socket — visible as eight requests starting together and finishing across a 1.4s
spread.

### The fix: collapse the waterfall

- **Login and register return the user with the token.** The server already knows who just
  authenticated; a follow-up "who am I?" request was a wasted round trip.
- **`GET /api/bootstrap`** returns everything the first paint needs in one response,
  queried concurrently server-side where there is no six-connection limit.

| | Before | After |
|---|---|---|
| Login path | 18 requests, 3 round trips | **4 requests, 2 round trips** |
| Reload path | 9 unique endpoints | **2** |

Two things about the design are worth more than the speedup:

**The queries are shared, not copied.** `routes/_crud.js` exposes its list query and
`habits`/`review` export theirs. A second copy of `select ... where user_id = $1` is a
second place to forget `user_id` — which is an authorization bug, not a performance one.

**A parity test asserts bootstrap deep-equals every individual route.** Without it the two
paths drift, and the dashboard silently renders different data than the routes it writes
back to.

**GitHub is deliberately excluded.** It's a ~600ms cold upstream call. Bundling it would
hold the entire first paint hostage to a third party having a slow day.

## Where it lives in this repo

| What | Where |
|---|---|
| The single bootstrap endpoint | `server/routes/bootstrap.js` |
| Shared list query (not duplicated) | `server/routes/_crud.js` |
| Parity test vs. the individual routes | `server/api.test.js` |
| Client fetches bootstrap, not `/auth/me` | `client/src/App.tsx` |
| Dashboard renders from supplied data | `client/src/pages/Dashboard.tsx` |

## Explain it in 60 seconds

> Someone said the app took 3–5 seconds to load. I measured each layer instead of
> guessing: the API answered eight endpoints in 83ms, login was 433ms, and end to end I
> got 377ms. I couldn't reproduce it, and I said so rather than optimizing at random.
>
> Their trace had the answer. bcrypt took 2716ms where it takes 253ms idle — and the same
> 10.7× factor applied to everything. A uniform slowdown across unrelated code paths isn't
> an app bug, it's CPU starvation, and their load average was 46 on 12 cores.
>
> But the trace exposed two real defects. 63% of the wait happened before the dashboard
> requested any data, because login, then "who am I", then the data were three serial
> round trips. And the eight "parallel" fetches weren't — Chrome caps HTTP/1.1 at six
> connections per origin, so two of them queued.
>
> I made login return the user with the token, and added one endpoint returning everything
> the first paint needs. Login went from 18 requests to 4. The part I'd defend hardest
> isn't the speedup though — it's that the new endpoint calls the same query functions the
> individual routes do, with a test asserting they stay identical. A second copy of that
> SQL is a second place to forget the user_id filter.

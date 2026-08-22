# 13 — Testing

## What problem it solves

Manual testing doesn't scale and doesn't repeat. You click through the app, it works, you
ship. Three weeks later a change to the streak query quietly breaks habit deletion, and
nobody notices until a user does.

Tests are **executable claims about behavior**. They cost time up front and pay it back
the first time one catches a regression you'd otherwise have shipped.

Every test in this repo exists because something specific could break. None of them test
that JavaScript works.

## How it works

We use `node --test`, built into Node — no Jest, no Vitest, no config. 73 tests, no
framework dependency, one command.

### The pyramid, and where we sit

- **Unit** — one function, no I/O. Fast, precise failures. `ratelimit.test.js`,
  `validate.test.js`.
- **Integration** — several pieces together, real database. Slower, catches wiring bugs
  unit tests can't. `api.test.js`, `habits.test.js`.
- **End-to-end** — a real browser. Slowest, most brittle, catches what nothing else does.
  We have none; the browser checks were done by hand.

Most of our value is in **integration** tests, deliberately. The bugs in a CRUD app aren't
in the functions — they're in the seams: does auth actually apply to this route, does the
query filter by user, does validation run before the handler.

### What we test, and why each one exists

**Security properties.** These are the tests that matter most, and every one maps to a
real vulnerability:

```js
test('every resource is isolated per user', ...)         // IDOR
test('SQL injection attempts are stored as literal text', ...)
test('no token means 401 on every habits route', ...)
test('github usernames reject path traversal', ...)
```

The isolation test doesn't just check the 404 — it re-reads the row from Postgres and
asserts the value is unchanged. **Asserting the response is not the same as asserting the
data.**

**Behavior that's easy to get subtly wrong.** The streak test seeds three consecutive
days, asserts `3`, then adds a completion five days back and asserts *still* 3:

```js
// a completion 5 days ago does not extend a run that already broke
assert.strictEqual(..., 3, 'gap must not join the runs');
```

That's the assertion that would catch a wrong `GROUP BY`. A test that only checks the
happy path would pass with badly broken logic.

**Bugs we actually hit.** `create fills defaults, update does not` exists because
`.partial()` kept defaults and PATCHing a title silently reset cadence (concept 08). Every
fixed bug should leave a test behind, or you get to fix it twice.

**Contracts, not implementations.** We assert status codes, `Location` headers, and
idempotency — the promises the API makes. Not which SQL runs. Rewrite the query and the
tests should still pass; that's what makes them refactoring-safe rather than refactoring-
resistant.

### Tests must not depend on each other or on your data

```js
const email = `api-${Date.now()}@example.com`;
```

Every run makes its own user. Two consequences: tests can't collide with each other or
with data you created by hand, and a failure is about the code rather than yesterday's
state.

Cleanup is one line, thanks to `on delete cascade`:

```js
after(async () => { await db.query('delete from users where email = any($1)', [[email, other]]); });
```

`app.listen(0)` picks a free port, so tests never fight your dev server or CI.

### Dates in tests

```js
const day = (n) => new Date(Date.now() - n * 86400000).toLocaleDateString('en-CA');
```

Relative to now, never hardcoded. A test with `'2026-08-18'` in it passes today and fails
forever after. And it goes through the same `?today=` parameter the browser uses (concept
02), so the test exercises the real timezone path.

### What we deliberately skipped

- **Mocking the database.** A mock that returns what you told it to proves your mock
  works. Ours is one `docker compose up` away — the real thing is cheaper than the fake.
- **Coverage targets.** 100% coverage of trivial code with 0% of the streak query is worse
  than the reverse. Cover what can break.
- **Frontend tests.** Real value once the client has logic worth testing; today it's
  mostly wiring, and eslint plus the build catch more per minute spent.

## Where it lives in this repo

| File | Kind | Covers |
|---|---|---|
| `server/auth.test.js` | unit | JWT verify: valid, forged, expired, malformed |
| `server/validate.test.js` | unit | every rejection case, create/update split |
| `server/ratelimit.test.js` | unit | bucket capacity, refill, per-key isolation |
| `server/habits.test.js` | integration | CRUD, idempotency, ownership |
| `server/api.test.js` | integration | streaks, injection, isolation across resources |

```bash
cd server && npm test        # all of it, needs docker compose up -d
node --test validate.test.js # one file
```

## Try it yourself

The real exercise: **break something on purpose and watch a test catch it.**

```bash
cd server
# remove the ownership filter from the habits UPDATE
sed -i '' 's/and user_id = \$\${values.length + 2}//' routes/habits.js
npm test        # "another user cannot see or touch this user's habits" fails
git checkout routes/habits.js 2>/dev/null || true
```

A test that never fails when you break the thing it covers isn't testing anything. If
you're unsure a test is real, this is how you find out.

## Explain it in 60 seconds

> Tests are executable claims about behavior. The pyramid is unit, integration, and
> end-to-end — fastest and most precise at the bottom, slowest and most realistic at the
> top.
>
> For a CRUD app most of the value is in integration tests against a real database,
> because the bugs aren't inside functions — they're in the seams. Does auth actually apply
> to this route, does the query filter by user, does validation run before the handler.
> Unit tests can't see any of that.
>
> The tests I care most about are the security ones: another user gets a 404 and the row is
> genuinely unchanged, an injection payload is stored as literal text, every route 401s
> without a token. And note the isolation test re-reads the database rather than trusting
> the response — asserting the response isn't the same as asserting the data.
>
> A few practices: each run creates its own user so tests never depend on each other or on
> data you clicked in by hand; dates are relative to now, never hardcoded, or the test
> passes today and fails forever after; and assert the contract — status codes, headers,
> idempotency — not which SQL ran, so refactoring doesn't break them.
>
> The test for whether a test is real: break the code on purpose and check that it fails.

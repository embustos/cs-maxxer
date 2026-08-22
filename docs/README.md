# cs maxxer — concept docs

One doc per concept, written after that concept's code landed, so every reference points
at code that actually runs in this repo.

Each doc has the same four sections:

1. **What problem it solves** — the failure you'd hit without it
2. **How it works** — the mechanism
3. **Where it lives in this repo** — `file.js:line` pointers
4. **Explain it in 60 seconds** — the version you'd say out loud

Read them in order; each builds on the last. If you only read the last section of each,
you'd still be able to hold your own in an interview.

## Phase 1 — how the web actually works

| | Doc | The one thing to remember |
|---|---|---|
| 01 | [HTTP + REST APIs](01-http-rest.md) | The URL names a thing; the method says what to do to it. Idempotency decides what's safe to retry. |
| 02 | [Client vs server](02-client-vs-server.md) | Everything you ship to the browser is public. The client is untrusted input. |
| 03 | [Auth basics](03-auth.md) | Authentication is once; authorization is every request. A JWT is signed, not encrypted. |

## Phase 2 — databases done right

| | Doc | The one thing to remember |
|---|---|---|
| 04 | [SQL + indexes](04-sql-indexes.md) | `EXPLAIN ANALYZE` or you're guessing. 120k rows scanned → 0 rows scanned, 90× faster. |
| 05 | [SQL injection](05-sql-injection.md) | Parameterize values. Column names come from your source, never the request. |
| 06 | [Migrations](06-migrations.md) | Never edit an applied migration. Write a new one. |

## Phase 3 — production thinking

| | Doc | The one thing to remember |
|---|---|---|
| 07 | [Env + secrets](07-env-secrets.md) | Read env in one place, fail fast at boot. A leaked secret is rotated, not deleted. |
| 08 | [Input validation](08-input-validation.md) | Validate at the trust boundary. Defaults belong to create, never update. |
| 09 | [Error handling](09-error-handling.md) | Timeout everything. Retry only what retrying can fix. An upstream failure is a 502. |
| 10 | [Caching](10-caching.md) | TTL is a stated staleness budget. A cache must never be able to break you. |
| 11 | [Rate limiting](11-rate-limiting.md) | Token bucket allows bursts, caps the average. Always send `Retry-After`. |
| 12 | [Logging](12-logging.md) | Structured JSON + a request id. Never log tokens or bodies. |

## Shipping it

| | Doc | The one thing to remember |
|---|---|---|
| 13 | [Testing](13-testing.md) | Test the seams and the security properties. Break it on purpose to check the test is real. |
| 14 | [CI](14-ci.md) | Proof that a clean checkout works. Health-check your service containers. |
| 15 | [CD + digest](15-cd-and-digest.md) | Deploy only green builds. Migrations before new code. Schedulers live outside the app. |
| 16 | [Measuring performance](16-performance.md) | Measure before you guess, and check the instrument. A uniform slowdown is the machine, not the code. |
| 17 | [Opening signups](17-public-accounts.md) | Reset and verify are one mechanism. Never answer "does this account exist?". Cap spend where a restart can't reset it. |

## Bugs found while building this

Real ones, each written up in the doc where it belongs — they're the most useful part:

- **Timezone** (02) — `done_today` used the database's UTC date, so habits looked unchecked
  after 5pm Pacific. Only the browser knows the user's timezone.
- **Redundant index** (04) — an index we added was already created by a `UNIQUE`
  constraint. Found by `EXPLAIN ANALYZE`; removed in a corrective migration.
- **PATCH resetting fields** (08) — `.partial()` kept schema defaults, so editing a habit's
  title silently reset its cadence to daily. Real data loss.
- **Logs lying about the path** (12) — a rate-limited login logged as `/login` instead of
  `/api/auth/login`, dropping the prefix on exactly the requests worth investigating.
- **GitHub payload shape** (09) — the events API omits the `commits` array, so the commit
  count was silently reading `undefined`.
- **StrictMode double-spent a token** (17) — the email-confirmation request ran in an
  effect, so React's development double-invoke redeemed the same single-use token twice.
  The page showed "Email confirmed" and "already been used" simultaneously.
- **Timing a hidden tab** (16) — every browser measurement in a performance investigation
  was taken in a background tab, where `requestAnimationFrame` never fires. The numbers
  described a page that wasn't rendering.
- **Deleted account stayed logged in** (03) — a token whose user row was gone still
  verified, and `/auth/me` fell back to the token's own claims. A valid signature does not
  prove the account still exists.

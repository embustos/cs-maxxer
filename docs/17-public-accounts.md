# 17 — Opening signups to strangers

## What problem it solves

Everything up to here assumed one user: you. Putting the app on the public internet
changes three things at once, and each of them is a way to get hurt.

**People forget passwords.** With register/login/me and nothing else, the first person who
forgets is locked out permanently — and so are you, because bcrypt is one-way.

**Anyone can type anyone's email.** Sign up as `someone@else.com` and that stranger starts
getting your mail. Enough of those and your sending domain is marked as spam, which breaks
email for every real user you have.

**Paid endpoints spend real money.** `POST /api/ai/review-message` calls Anthropic. The
existing rate limiter caps how *fast* that can happen, but it has no notion of a total —
and it lives in a `Map`, so a deploy hands everyone a fresh budget.

## How it works

### Reset and verification are the same machinery

Both are: generate a random token, mail it as a link, accept it once, expire it. So they
share one table and one code path (`server/tokens.js`), separated by a `purpose` column
that `redeem()` checks — a confirm-your-email link must not also be able to reset a
password, or every old signup email becomes an account takeover.

**Store the hash, never the token.** `email_tokens.token_hash` holds a sha256. A read-only
leak of that table is then worth nothing, for the same reason `users.password_hash` exists
instead of `users.password`.

sha256 and not bcrypt, deliberately. bcrypt is slow *on purpose* because passwords are
low-entropy and guessable. A 256-bit random token is not guessable, so the slowness would
buy nothing.

**Single use is enforced by the UPDATE, not by a read.** 

```sql
update email_tokens set used_at = now()
 where token_hash = $1 and purpose = $2 and used_at is null and expires_at > now()
 returning user_id
```

Two requests racing the same token both pass a *read*; only one can win that *update*.

**Issuing a new token deletes the old one.** Without that, every "I forgot my password"
click leaves another live key to the account sitting in an old inbox.

### /auth/forgot must not answer the question it's asked

```js
if (rows[0]) { /* ...send the mail... */ }
res.json({ ok: true });   // always, for every address
```

A 404 for an unknown address turns this endpoint into a free "does this person have an
account here?" oracle. Same status, same body, every time — including when the mail
provider errors, which is why that `catch` logs instead of responding.

Login and register disclose existence by design (see the tradeoff in docs/03), so this
opacity is no longer load-bearing — but there is also nothing useful for the response to
say, and keeping it symmetric costs nothing.

### Verification gates the mail, not the login

Blocking a new user at the door over an unread email is how you lose them. So
`email_verified_at` gates exactly one thing — the digest query:

```sql
where reminder_cadence is distinct from 'off' and email_verified_at is not null
```

Nobody can click a link in an inbox they don't read, so an unverified address never
receives anything. One clause, and the spam vector is closed.

### Two limits, because they answer different questions

| | `middleware/rateLimit.js` | `middleware/aiQuota.js` |
|---|---|---|
| Asks | how fast? | how much? |
| Lives in | an in-process Map | Postgres |
| Survives a deploy | no | yes |
| Stops | a runaway retry loop | a determined user |

The quota increments and reads in one statement, because select-then-update lets two
concurrent requests both read 39 and both proceed — the classic lost update:

```sql
update users
   set ai_calls  = case when ai_period = date_trunc('month', now())::date
                        then ai_calls + 1 else 1 end,
       ai_period = date_trunc('month', now())::date
 where id = $1 returning ai_calls
```

That `case` is also the monthly reset: the first call of a new month overwrites the
counter instead of adding to it. No cron job, no cleanup, no stale rows.

**Charge on the work, not on the request.** One route serves a cached review when it has
one, so it calls `aiQuota.consume()` itself *after* the cache check rather than taking the
middleware. Billing a quota for a row you already had is billing for nothing.

**And set a spend cap in the Anthropic console too.** It's external, so no bug in this
code can bypass it. Defence in depth means the layers fail independently.

### Selling more, safely

Out of free reviews is a dead end only if there's no door. Credit packs are sold through
Stripe Checkout (`server/routes/billing.js`): the user pays on Stripe's page — we never
see a card number — and the **webhook is the only place money becomes credits**. Three
properties carry all of it, and each has a direct test:

1. **The signature is the auth.** The webhook has no `requireAuth`; instead the raw
   request body is verified against Stripe's HMAC. Raw matters — the route is mounted
   with `express.raw()` ahead of the JSON parser, because the signature covers the exact
   bytes and a parse/re-serialize round trip would break it.
2. **The user id comes from our JWT, not Stripe's payload.** Checkout sessions carry
   `client_reference_id` set server-side from the authenticated user — nothing an
   attacker can type into a form decides who gets credited.
3. **Retries credit once.** Stripe re-sends any webhook it isn't sure was received.
   Every processed event id is recorded (`stripe_events`), and the insert-or-conflict is
   the gate: double-crediting a retry is money invented from nothing.

Login being gated on verification also raises the stakes on the domain: until a domain
is verified in Resend, the free tier only delivers to your own address — which would
strand every new signup at "check your inbox". The domain is a signup prerequisite now,
not a digest nicety.

### One bug worth keeping

The verify page ran its request in a `useEffect`. React StrictMode invokes effects twice
in development — so the second call redeemed an already-redeemed token, and the page
rendered **"Email confirmed"** and **"that link has already been used"** at the same time.

A `useRef` guard fixes it. An effect that *spends* something is not safe to double-fire,
for the same reason a payment isn't.

## Where it lives in this repo

| What | Where |
|---|---|
| Token issue / redeem | `server/tokens.js` |
| Reset, verify, forgot routes | `server/routes/auth.js` |
| Monthly AI spend cap | `server/middleware/aiQuota.js` |
| One mailer for job + auth | `server/email.js` |
| Verified-only digest query | `server/jobs/digest.js` |
| Tests never send real mail | `server/email.js`, `server/accounts.test.js` |
| Reset / verify landing page | `client/src/pages/EmailAction.tsx` |

## Explain it in 60 seconds

> Opening signups meant three new failure modes. People forget passwords and bcrypt is
> one-way, so without a reset flow they're locked out forever. Anyone can sign up with a
> stranger's email, and mailing strangers gets your domain marked as spam. And the AI
> endpoints spend real money with no cumulative cap.
>
> Reset and verification are the same machinery — random token, mailed, single use,
> expires — so they share a table and differ by a purpose column, which `redeem` checks so
> a verify link can't reset a password. The table stores a sha256, not the token, so
> leaking it is worth nothing. Single use is enforced by the UPDATE's own where-clause,
> because two requests racing the same token both pass a read.
>
> `/auth/forgot` returns the same 200 for every address, including ones with no account —
> otherwise it's a free "who has an account here?" lookup.
>
> Verification doesn't block login, it blocks the digest: one `and email_verified_at is not
> null` in that query, and you can never mail an address nobody has proven they read.
>
> For spend there are two limits: the existing rate limiter for how fast, and a monthly
> counter in Postgres for how much — because the rate limiter lives in a Map and a deploy
> resets it. The counter increments and reads in one statement, since select-then-update
> loses concurrent increments.

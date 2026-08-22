# 03 — Auth basics: sessions, JWTs, cookies

## What problem it solves

HTTP is stateless. The request that logs you in and the next request that asks for your
habits are unrelated events — the server has already forgotten you. So every request
after login has to answer, on its own: **who is this?**

The naive answer is to let the client say so: `GET /api/habits?userId=42`. That works
until someone types `43`. Anything the client sends, the client can change.

Two separate jobs hide inside "auth", and conflating them is the most common confusion:

| | Question | Runs | Tool |
|---|---|---|---|
| **Authentication** | Who are you? | once, at login | bcrypt |
| **Authorization** | Are you allowed to touch *this*? | every request | JWT + `user_id` filter |

## How it works

### Passwords: bcrypt, and why not SHA-256

Never store a password. Store a one-way hash, and compare hashes at login.

But not any hash. SHA-256 is built to be **fast** — a GPU does billions per second, so a
stolen database of SHA-256 hashes is cracked in hours. bcrypt is built to be **slow and
tunable**:

```js
bcrypt.hash(password, 12)   // 12 = cost factor, 2^12 rounds, ~250ms
```

That 250ms is invisible to a user logging in once, and ruinous to an attacker trying
billions. When hardware gets faster, you raise the cost factor.

bcrypt also **salts automatically**. Every hash embeds a random salt, so two people with
the same password get different hashes, and a precomputed table ("rainbow table") is
worthless. Look at a stored value — `$2b$12$SQpF...` — that's algorithm, cost, salt, hash.

One subtle thing at `server/routes/auth.js:24`:

```js
const DUMMY_HASH = bcrypt.hashSync('no-such-user', 12);
...
const ok = await bcrypt.compare(password, user?.password_hash ?? DUMMY_HASH);
```

If we skipped the comparison when the email didn't exist, login would return *faster*
for unknown emails than real ones. That timing difference is measurable over the network,
and it turns your login into an **account enumeration oracle** — an attacker learns which
emails are registered. Comparing against a dummy hash keeps both paths the same duration.

### The token: what a JWT is

Three base64url segments joined by dots:

```
eyJhbGciOiJIUzI1NiJ9 . eyJzdWIiOjEsImV4cCI6MTc4N30 . 4Xk9mQ...
   header (algorithm)      payload (the claims)      signature
```

**It is signed, not encrypted.** Anyone holding the token can read the payload — paste it
into jwt.io. So never put anything private in it. We put a user id.

The signature is the entire mechanism:

```
signature = HMAC-SHA256( base64(header) + "." + base64(payload),  JWT_SECRET )
```

Verifying is *not* decryption. The server recomputes that HMAC from the two segments it
received and compares to the third. Equal → we minted it. Not equal → reject. Change one
byte of the payload and the signature no longer matches, and you can't produce a new one
without `JWT_SECRET`, which never leaves the server.

Standard claims: `sub` (subject — the user id), `iat` (issued at), `exp` (expires).
`exp` is checked by the verifier, not the client.

### JWT vs session vs cookie — the actual tradeoff

These get muddled because they answer different questions. **Session vs JWT** is *where
the state lives*. **Cookie vs header** is *how the token travels*. They're independent.

| | Sessions | JWT |
|---|---|---|
| Server stores | a row per login | nothing |
| Per-request cost | a DB/Redis lookup | one HMAC, no I/O |
| Revoke instantly | yes — delete the row | **no** |
| Scales across servers | needs shared session store | works anywhere the secret is |

**The JWT's headline feature and its headline flaw are the same fact.** Statelessness is
why it needs no lookup, and it's why you cannot un-issue one. Ban a user and their token
keeps working until `exp`. That's the trade: speed and simplicity, paid for in revocation.

Mitigations, in order of cost: short expiry (minutes, plus a refresh token), or a
denylist of revoked token ids — which reintroduces the lookup you removed. If instant
revocation matters more than statelessness, **use sessions**. That's a legitimate answer,
and "JWTs are always better" is wrong.

Our choice: 7-day tokens, no refresh (`server/routes/auth.js:17`). Fine for a personal
tracker. The panic button is changing `JWT_SECRET`, which invalidates every token ever
issued at once.

**A concrete bite from statelessness, found while building this.** After wiping the
database, an old token still rendered a logged-in dashboard. `jwt.verify` succeeded — the
signature was fine — but the user row no longer existed. `/auth/me` had been falling back
to the token's own claims, so a *deleted account stayed logged in for the rest of the
7 days*.

The fix (`server/routes/auth.js:156`) is an explicit existence check:

```js
if (!rows[0]) return res.status(401).json({ error: 'account no longer exists' });
```

That's a database lookup — the very thing JWTs exist to avoid. Doing it on `/auth/me`
only, once per page load rather than once per request, is the compromise: deletion takes
effect immediately, and the hot paths stay stateless. **A valid signature proves the token
was issued by us. It does not prove the account still exists.**

### localStorage vs httpOnly cookie

Where the browser keeps the token. Neither is strictly safer — they fail differently:

- **localStorage** (what we use). Any JavaScript on the page can read it, so an XSS bug
  is a stolen token. Immune to CSRF, because it's only sent when our code chooses to.
- **httpOnly cookie**. JavaScript literally cannot read it, so XSS can't exfiltrate it.
  But the browser attaches it to *every* request to your domain, including ones triggered
  by another site — that's CSRF, and you need `SameSite` and/or CSRF tokens to stop it.

Rule of thumb: httpOnly cookies for anything with real consequences; localStorage is a
reasonable call for a personal app, and it's simpler. We chose simple, knowingly.

## Where it lives in this repo

| What | Where |
|---|---|
| Hash on register, cost 12 | `server/routes/auth.js:28` |
| Constant-time login path | `server/routes/auth.js:24`, `:62` |
| Mint the token | `server/routes/auth.js:17` |
| Verify it, populate `req.user` | `server/middleware/auth.js:11` |
| Reject bad/expired tokens | `server/middleware/auth.js:14` |
| Secret, read once | `server/config.js:22` |
| Store the token | `client/src/api.ts` |
| Attach it to every request | `client/src/api.ts` |
| Drop it on 401 | `client/src/api.ts` |
| Confirm it on page load | `client/src/App.tsx` |

The payoff is one line, repeated in every query in the app:

```sql
where user_id = $1     -- $1 is req.user.id, which came from a signature we made
```

The URL is never trusted alone. That's what makes `404` on someone else's habit correct
rather than accidental.

## Try it yourself

```bash
docker compose up -d && cd server && npm run dev

TOKEN=$(curl -s -X POST localhost:3000/api/auth/login -H 'content-type: application/json' \
  -d '{"email":"emi@test.com","password":"password123"}' | node -pe 'JSON.parse(require("fs").readFileSync(0)).token')

# read the payload — no secret needed
node -pe "Buffer.from('$TOKEN'.split('.')[1],'base64url').toString()"

# tamper with it: flip one character of the signature
curl -s localhost:3000/api/habits -H "Authorization: Bearer ${TOKEN}x"
```

Then look at a stored hash and notice it starts `$2b$12$` — algorithm, cost, salt:

```bash
docker exec cs-tracker-db-1 psql -U cstracker -d cs_tracker \
  -c "select left(password_hash, 30) from users limit 1"
```

## Explain it in 60 seconds

> Authentication and authorization are different jobs. Authentication happens once, at
> login: you prove who you are with a password, and we check it against a bcrypt hash.
> bcrypt because it's deliberately slow and auto-salted — SHA-256 is fast, which is
> exactly wrong for passwords.
>
> After that, every request has to prove who you are again, because HTTP is stateless. We
> use a JWT: a JSON payload with your user id, signed with a server-side secret. It's
> signed, not encrypted — anyone can read it, nobody can forge it, because forging needs
> the secret. The server verifies by recomputing the signature, so there's no database
> lookup at all.
>
> That statelessness is the whole tradeoff. It's fast and scales trivially, but you can't
> revoke a token — ban someone and their token works until it expires. Sessions are the
> opposite: a row you can delete instantly, at the cost of a lookup on every request. If
> instant revocation matters, sessions are the right answer.
>
> Separately, there's where the browser stores it. localStorage is readable by JavaScript,
> so XSS steals it. An httpOnly cookie isn't, but it's sent automatically on every request,
> which opens up CSRF. Different failure modes, not one being simply better.

# 02 — Client vs server

## What problem it solves

You now have two programs running on your laptop, on two different ports:

```
localhost:5173   Vite — serves the React app to the browser      (the CLIENT)
localhost:3000   Node — serves the API, talks to Postgres        (the SERVER)
```

Knowing which one your code runs in decides three things you cannot get wrong:

1. **Who can read it.** Client code ships to strangers. Server code doesn't.
2. **Who can lie about it.** Client code runs on a machine you don't control.
3. **What it can reach.** Only the server can touch the database.

Get this backwards and you put an API key in React, or trust a `<input maxlength>` to
protect your database. Both are real, common, and fatal.

## How it works

### Everything in `client/src` is public. Everything.

Not "hard to see" — literally downloadable. It has to be: the browser can't run code it
wasn't sent. Proof, from this repo, right now:

```bash
curl -s http://localhost:5173/src/api.ts
```

That returns your source, **comments included**. The production build only minifies it:

```bash
cd client && npm run build
grep -o 'localhost:3000/api' dist/assets/*.js     # → localhost:3000/api
```

The URL is sitting in the shipped bundle. So the rule has no exceptions:

> **Never put a secret in client code.** Not an API key, not a database password, not a
> JWT signing secret. Not in a `.env` file Vite reads — anything Vite inlines becomes
> part of the bundle. If the browser can use it, the user can read it.

This is why `JWT_SECRET` lives in `server/.env` and gets read at
`server/middleware/auth.js`, on the server, always. The browser holds a *token* (useless
for forging others) but never the *secret* (which mints any token you like).

### The client is an untrusted input device

Anyone can open DevTools and call your API directly with curl. So:

- **Client-side validation is a courtesy.** `minLength={8}` on the password field
  (`client/src/pages/Login.tsx`) makes the form pleasant. It stops nobody. Delete it from
  the DOM in five seconds.
- **Server-side validation is the real thing.** `server/routes/habits.js` re-checks every
  field regardless of what the client claims to have checked.

Both exist, for different reasons: the client one saves a round trip, the server one is
the actual defense. Never only the first.

### The server is the only thing that touches the database

Look at the flow when you tick a checkbox:

```
  You click ─► Dashboard.tsx toggle()
                    │  fetch PUT /api/habits/1/completions/2026-08-17
                    │  Authorization: Bearer eyJ…
                    ▼
              habits.js route  ─► verifies token, gets req.user.id
                    │  db.query('insert into habit_completions …', [id, req.user.id, date])
                    ▼
                 Postgres
```

The browser never speaks SQL and has no database credentials. If it did, "delete every
row" would be one DevTools command away. The server is a gate: it decides what SQL is
allowed to exist, and it stamps every query with an id that came from a signed token.

### Why CORS exists

`localhost:5173` and `localhost:3000` are **different origins** (origin = protocol +
host + port). Browsers block cross-origin requests by default, or any site you visited
could quietly call your bank's API using your cookies.

`server/index.js:11` opts in explicitly: this origin is allowed to call me.
CORS is enforced *by the browser*, not the server — curl ignores it entirely. It protects
users from malicious sites, not servers from attackers.

### Where "today" happens

A concrete case of "which machine is this?" — and a real bug I hit building this.

`done_today` was computed in SQL with `current_date`, which is the **database's** clock.
The container runs UTC. At 5pm in California, UTC is already tomorrow — so you'd check a
habit off and watch it stay unchecked, because the server was comparing against a
different day than you were living in.

Only the browser knows the user's timezone. So the client computes its own date
(`Dashboard.tsx`) and sends it (`habits.js:25`). Same idea as secrets, opposite
direction: some facts only the client has, some only the server has.

## Where it lives in this repo

| What | Where |
|---|---|
| Auth gate — which page renders | `client/src/App.tsx` |
| Verify the stored token before trusting it | `client/src/App.tsx` |
| Render nothing while checking | `client/src/App.tsx` |
| Every request gets the token, in one place | `client/src/api.ts` |
| 401 → drop the dead token | `client/src/api.ts` |
| Local date, browser-side | `client/src/pages/Dashboard.tsx` |
| Optimistic update | `client/src/pages/Dashboard.tsx` |
| CORS allowlist | `server/index.js:11` |
| Server accepts client's date | `server/routes/habits.js:33` |

Two patterns worth naming:

**The token is checked, not assumed** (`App.tsx`). A token in localStorage proves
nothing — it may be expired or edited. On load the client asks `/auth/me` and only the
server's answer counts. `checking` renders nothing until then, so a stale token never
flashes the dashboard.

**Optimistic updates** (`Dashboard.tsx`). The checkbox flips instantly, then the
request goes out. If it fails we reload and the server's version wins. This is a
deliberate lie for the sake of feel — the UI shows what will *probably* be true. The
`catch` is what keeps the lie honest.

## Try it yourself

```bash
docker compose up -d
cd server && npm run dev      # :3000
cd client && npm run dev      # :5173
```

1. Open DevTools → Network, tick a checkbox. Watch the `PUT` go out — that's the only
   thing crossing between the two programs.
2. DevTools → Application → Local Storage → your token. Paste it at jwt.io: readable.
   That's the point — it's signed, not secret.
3. Stop the API server (`ctrl-C` in the server terminal), leave the client running, and
   tick a checkbox. The client survives; the request fails. Two programs, independent
   lifecycles.
4. `curl -s http://localhost:5173/src/pages/Dashboard.tsx` — read your own source, the
   way any visitor could.

## Explain it in 60 seconds

> A web app is two programs. The client runs in the user's browser; the server runs on a
> machine you control. The split matters for three reasons.
>
> First, everything you ship to the client is public — you can curl the JavaScript and
> read it, comments and all. So no secrets in frontend code, ever. Anything the browser
> can use, the user can read.
>
> Second, the client is untrusted input. Anyone can bypass your React form and hit the
> API with curl, so client-side validation is only there to make the form feel nice. The
> server has to re-check everything, because that's the only check that can't be skipped.
>
> Third, only the server touches the database. The browser has no credentials and speaks
> no SQL — it asks the server, and the server decides what's allowed.
>
> The flip side is that some facts only the client has. The user's timezone, for one — we
> hit a real bug where the database computed "today" in UTC and habits looked unchecked
> after 5pm Pacific. The fix was to let the browser say what day it is, because it's the
> only one that knows.

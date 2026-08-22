# 01 — HTTP + REST APIs

## What problem it solves

Your React app and your server are two separate programs. They might be on the same
laptop or on opposite sides of the planet, and they can't share variables or call each
other's functions. The only thing they can do is **send each other text over a network**.

HTTP is the agreed format for that text. REST is a convention for organizing it so that
someone who has never seen your API can guess how it works.

Without a convention you end up with this, which is a real thing that real codebases do:

```
POST /getHabits
POST /addNewHabit
POST /habitUpdate2
POST /removeHabitById
```

Every action is a new invented verb, everything is POST, and nothing is predictable. The
person who joins your team has to read all your code to find out that "update" is spelled
`habitUpdate2`.

## How it works

### First: HTTP is not how the server talks to the database

There are three programs here and **two different conversations**, and mixing them up
will confuse everything that follows:

```
   Browser  ──── HTTP ────►  Your server  ──── SQL ────►  Postgres
   (React)   "GET /api/habits"    (Node)      "select ... from habits    (container)
              Authorization: …                 where user_id = $1"
```

- **Browser → server** speaks **HTTP**: methods, paths, status codes, JSON.
  That's `server/routes/habits.js`.
- **Server → database** speaks **SQL** over a Postgres connection. No methods, no URLs,
  no status codes. That's `db.query(...)`.

`GET` does not mean `select`. A `POST` handler can touch zero tables; a `GET` can query
five. The resemblance is a coincidence of CRUD apps, not a rule.

Why it matters: **the database has no idea who is logged in.** It runs whatever SQL it's
handed. The server is the only layer that knows who's asking, which is why every query
passes `req.user.id` explicitly. Picture HTTP as reaching the database directly and you
delete the layer doing all the security work.

### What REST stands for

**RE**presentational **S**tate **T**ransfer — coined by Roy Fielding in a 2000 PhD
dissertation. He co-authored the HTTP spec, and the paper was largely explaining why the
web already worked so well.

- **Resource** — a thing on the server. Habit #2. Rows in Postgres.
- **Representation** — what actually gets sent: `{"id":2,"title":"LeetCode daily"}`. Not
  the thing itself, a *rendering* of it. The same resource could be sent as JSON, XML, or
  HTML. You never touch the rows; you get a picture of them.
- **Transfer of state** — fetch a representation, change it, send it back.

Of Fielding's constraints, the one that matters most here is **statelessness**: the server
keeps nothing about you between requests. Every request arrives self-contained.

That single constraint is what forced the JWT into existence:

> HTTP is stateless → the server can't remember you → every request must carry its own
> proof of identity → JWT.

### The anatomy

Every HTTP request is four things: a **method**, a **path**, **headers**, and an optional
**body**. Every response is a **status code**, **headers**, and an optional **body**.

The REST idea is one sentence: **the URL names a thing, the method says what to do to it.**

```
GET    /api/habits        →  give me the collection
POST   /api/habits        →  add one to the collection
PATCH  /api/habits/2      →  change part of habit 2
DELETE /api/habits/2      →  remove habit 2
```

Same noun. The verb carries the intent. You never invent `/deleteHabit` because `DELETE`
already exists.

### The methods, and the one property that actually matters

**Idempotent** means: doing it twice leaves the world exactly as it was after doing it
once. This is not academic trivia — it decides whether a client can safely retry when the
network hiccups.

| Method | Purpose | Idempotent? | Safe to retry? |
|---|---|---|---|
| `GET` | read | yes | yes |
| `POST` | create | **no** | **no** — you get two |
| `PUT` | create/replace at a known URL | yes | yes |
| `PATCH` | partial update | usually | usually |
| `DELETE` | remove | yes | yes |

We use both POST and PUT in this codebase, deliberately:

- `POST /api/habits` — the server picks the id, so it can't be idempotent. Two requests,
  two habits. That's why the response is `201 Created` with a `Location` header telling
  you where the new thing lives.
- `PUT /api/habits/2/completions/2026-08-16` — *you* supply the full address. The request
  means "this habit is done on this date." Send it once or five times, the answer is the
  same. Verified: two identical PUTs produced exactly one row.

### Status codes

The first digit is the whole story: **2xx** worked, **4xx** you messed up, **5xx** we
messed up. That 4xx/5xx split is the important one — it's the difference between "your
request was wrong" and "your request was fine and our server is broken."

| Code | Meaning | Where we use it |
|---|---|---|
| 200 OK | worked, here's the data | `GET /api/habits` |
| 201 Created | made a new thing | `POST /api/habits` |
| 204 No Content | worked, nothing to say | `DELETE`, completions |
| 400 Bad Request | your input is invalid | empty title, `cadence: "hourly"` |
| 401 Unauthorized | no valid token — *who are you?* | any route, no token |
| 404 Not Found | no such thing | habit that isn't yours |
| 500 Server Error | our bug | unhandled exception |

**401 vs 403** trips everyone: 401 is "I don't know who you are" (bad or missing token),
403 is "I know who you are and you still can't." We deliberately never send 403 — see
below.

## Where it lives in this repo

| What | Where |
|---|---|
| URL space carved into files | `server/index.js:25-30` |
| JSON body parsing | `server/index.js:12` — without this, `req.body` is `undefined` |
| Auth on every habits route | `server/routes/habits.js:11` |
| `GET` collection | `server/routes/habits.js:33` |
| `POST` create → 201 + Location | `server/routes/habits.js:76`, `:85` |
| `PATCH` partial update | `server/routes/habits.js:90` |
| `DELETE` → 204 | `server/routes/habits.js:114`, `:123` |
| `PUT` idempotent completion | `server/routes/habits.js:129` |
| Catch-all 404 | `server/index.js:32` |
| Error handler → 500 | `server/index.js:36` |

Three decisions in there worth understanding, because they're the kind of thing that
separates a working API from a correct one:

**1. Not-yours returns 404, never 403.** `server/routes/habits.js:109`. If a stranger asks
to edit habit #2 and we answered `403 Forbidden`, we'd have just confirmed habit #2
exists. Answer 404 for both "doesn't exist" and "isn't yours" and they learn nothing.
Verified: a second account probing ids gets 404 and the row is untouched.

**2. Every query filters by `user_id`.** Look at any query in the file — `where h.user_id
= $1`, `where id = $1 and user_id = $2`. The database never trusts the URL alone. This is
the entire payoff of the JWT: `req.user.id` was signed by us, so it can't be faked.

**3. A garbage id is a 404, not a 500.** `server/routes/habits.js:17`. `req.params` values
are always strings, so `/api/habits/abc` would send `"abc"` to Postgres and crash with a
type error — a 500, meaning *we* broke, when really the user asked for a habit that
doesn't exist. `asId` normalizes it.

## Try it yourself

```bash
docker compose up -d
cd server && npm run dev

TOKEN=$(curl -s -X POST localhost:3000/api/auth/login \
  -H 'content-type: application/json' \
  -d '{"email":"emi@test.com","password":"password123"}' | node -pe 'JSON.parse(require("fs").readFileSync(0)).token')

# -i shows the status line and headers, not just the body — look at the Location header
curl -i -X POST localhost:3000/api/habits \
  -H 'content-type: application/json' -H "Authorization: Bearer $TOKEN" \
  -d '{"title":"LeetCode daily"}'

# same request twice — count the habits afterwards. POST is not idempotent.
curl -s localhost:3000/api/habits -H "Authorization: Bearer $TOKEN"
```

Then do the same with a `PUT` to a completion URL twice and watch the row count stay at 1.

## Explain it in 60 seconds

> HTTP is how two programs talk over a network, because they can't share memory or call
> each other's functions — they can only send text. A request has a method, a path, and
> maybe a body; a response has a status code and maybe a body.
>
> REST is a convention for organizing that: the URL names a resource, and the HTTP method
> says what you're doing to it. `GET /habits` reads them, `POST /habits` creates one,
> `DELETE /habits/2` removes one. You don't invent verbs like `/deleteHabit`, because the
> method already is the verb.
>
> The property that matters most is idempotency — whether doing something twice differs
> from doing it once. `GET`, `PUT`, and `DELETE` are idempotent, so a client can safely
> retry them after a network failure. `POST` isn't, which is why double-clicking a
> submit button can create two records.
>
> Status codes tell you who's at fault: 2xx worked, 4xx the caller sent something wrong,
> 5xx the server broke. And one subtlety — when someone asks for a record that exists but
> isn't theirs, return 404 rather than 403, because 403 leaks the fact that it exists.

# 08 — Input validation

## What problem it solves

Every byte arriving at your server came from a machine you don't control. The React form
is a suggestion, not a constraint — anyone can bypass it entirely:

```bash
curl -X POST localhost:3000/api/goals -H 'content-type: application/json' \
  -d '{"title":"","target":-99999999}'
```

No form, no `required`, no `min`. Without server-side validation that reaches your
database. So:

> **Client-side validation is for user experience. Server-side validation is for
> correctness and security. You need both, and only one of them is load-bearing.**

Without it you get: crashes on unexpected types (a 500 where a 400 belongs), garbage rows
that break every consumer downstream, `NaN` propagating through arithmetic, unbounded
strings filling your disk, and — most subtly — **mass assignment**, where a request sets a
field you never meant to expose.

## How it works

A **schema** declares the shape you accept. Input either matches or it's rejected, at the
edge, before any business logic runs. We use zod; joi and yup are equivalent choices.

`server/schemas.js`:

```js
const goal = entity({
  title: trimmed(160),
  target: z.coerce.number().int().min(1).max(100000),
  current: z.coerce.number().int().min(0).max(100000),
  due_on: isoDate.nullish(),
}, { current: 0 });
```

Then one middleware turns any schema into a gate (`server/middleware/validate.js`):

```js
module.exports = (schema, source = 'body') => (req, res, next) => {
  const result = schema.safeParse(req[source]);
  if (!result.success) { ...400 with a readable message... }
  req[source] = result.data;   // ← the important line
  next();
};
```

That last assignment is what makes it worth doing. `req.body` is **replaced** with the
parsed value: trimmed, coerced, defaults filled, unknown keys stripped. Route handlers
never touch raw input, so they don't re-check anything.

### Validation is also normalization

Rejecting is half the job. `server/schemas.js:27`:

```js
email: z.string().trim().toLowerCase().pipe(z.email().max(254)),
```

**Order matters, and I got this wrong the first time.** Validating first meant
`" Me@School.edu "` was rejected for whitespace the user never intended to type. Worse,
without lowercasing, `Me@School.edu` and `me@school.edu` become two accounts — the UNIQUE
constraint is case-sensitive and won't save you. Normalize, then validate.

Same idea with `z.coerce.number()`: an HTML number input submits the *string* `"50"`.
Coercion turns it into `50` before the bounds check, so the route gets a real number.

### The bug that split create from update

The first version derived update schemas with `.partial()`:

```js
habitUpdate: habitCreate.partial()
```

Which looks right — every field optional, that's what PATCH means. But defaults **still
applied**. A PATCH sending only `{title}` came out as:

```js
{ title: 'x', cadence: 'daily', target_per_week: 7 }
```

So editing a habit's title would silently reset a weekly habit to daily. A real data-loss
bug from a one-word helper. The fix (`server/schemas.js:17`) builds both from one field
list, applying defaults only to create:

```js
const entity = (fields, defaults = {}) => ({
  create: z.object(fields).extend(...defaults applied...),
  update: z.object(fields).partial(),        // no defaults
});
```

**Defaults belong to creation. Editing something must not invent values the user didn't
send.** There's a test pinning this (`server/validate.test.js`).

### Stripping unknown keys prevents mass assignment

zod drops keys not in the schema. That's a security property, not tidiness. Consider:

```bash
curl ... -d '{"title":"x","user_id":999,"stage":"offer"}'
```

If that object were spread straight into an `UPDATE`, a user could reassign their row to
someone else. Because `user_id` isn't in the schema it's gone before any route sees it —
and every query then hardcodes `user_id = req.user.id` from the token anyway. Two
independent layers.

This also feeds concept 05: the dynamic-`SET` builders iterate over parsed keys, so a key
like `"title; drop table--"` has already been discarded.

### Validate at the boundary, once

The pattern is a **trust boundary**: everything outside is hostile, everything past the
gate is known-good. Validating in the middleware means the route, the query, and anything
downstream can stop being defensive. Sprinkling checks through business logic instead gets
you inconsistent messages and gaps.

Things worth bounding that people forget:
- **Body size** — `express.json({ limit: '100kb' })` in `server/index.js:12`. Without it,
  someone POSTs a 2GB body and your process dies. Free DoS protection.
- **String length** — every string in our schemas has a `.max()`.
- **Numbers** — `.int()` and bounds. `1.5` reaching a `count` column is a 500.

## Where it lives in this repo

| What | Where |
|---|---|
| All schemas | `server/schemas.js` |
| Schema → middleware | `server/middleware/validate.js` |
| create/update split | `server/schemas.js:17` |
| Normalize-then-validate | `server/schemas.js:27` |
| Applied to routes | `server/routes/habits.js:76`, `server/routes/_crud.js:27` |
| Body size limit | `server/index.js:12` |
| Rejection tests | `server/validate.test.js` |

Two things stay hand-validated on purpose: `:id` params (`asId`, → 404 not 400, because a
malformed id is really "no such thing") and the `?today=` query (a regex, in the route).

## Try it yourself

```bash
TOKEN=...  # from a login

curl -s -X POST localhost:3000/api/goals -H 'content-type: application/json' \
  -H "Authorization: Bearer $TOKEN" -d '{"title":"","target":5}'
# {"error":"title: Too small: expected string to have >=1 characters"}

# coercion: a string number is accepted and stored as a number
curl -s -X POST localhost:3000/api/goals -H 'content-type: application/json' \
  -H "Authorization: Bearer $TOKEN" -d '{"title":"test","target":"50"}'

# mass assignment: user_id is silently dropped
curl -s -X POST localhost:3000/api/goals -H 'content-type: application/json' \
  -H "Authorization: Bearer $TOKEN" -d '{"title":"x","target":5,"user_id":999}'
```

Check the last one in the database — `user_id` is yours, not 999.

## Explain it in 60 seconds

> Everything arriving at your server came from a machine you don't control, so the React
> form is a suggestion — anyone can curl the endpoint directly. Client validation is for
> UX; server validation is the one that actually protects anything.
>
> We declare a schema per shape with zod and turn it into middleware that runs before the
> route. If input doesn't match, it's a 400 at the edge. If it does, `req.body` is replaced
> with the parsed value — trimmed, coerced, defaults filled, unknown keys stripped — so the
> route never touches raw input.
>
> Two subtleties. Validation is also normalization, and order matters: we trim and
> lowercase the email *before* validating it, otherwise trailing whitespace gets rejected
> and `Me@X.com` becomes a second account.
>
> And defaults belong to create, not update. We originally derived the PATCH schema with
> `.partial()`, which kept the defaults — so editing a habit's title silently reset its
> cadence. Real data loss from one word. Now create and update are built from the same
> field list with defaults applied only to create.
>
> The other thing schemas buy you is stripping unknown keys, which kills mass assignment —
> someone POSTing a `user_id` field can't reassign their row, because that key is gone
> before any code sees it.

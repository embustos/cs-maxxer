# 05 — SQL injection

## What problem it solves

SQL injection is what happens when user input becomes **executable SQL** instead of
staying **data**. It has been the #1 or #2 web vulnerability for twenty-five years, and
it is completely, cheaply preventable.

The classic:

```js
db.query(`select * from users where email = '${email}'`)   // NEVER
```

Someone submits `' or '1'='1` and the database receives:

```sql
select * from users where email = '' or '1'='1'
```

Every user, returned. Submit `'; drop table users;--` and you lose the table. The database
did nothing wrong — it received valid SQL and ran it. The bug is that string
concatenation cannot tell the difference between *what the query means* and *what the
user typed*.

## How it works

**Parameterized queries** send the SQL and the values to the database as two separate
things:

```js
db.query('select * from users where email = $1', [email])
```

Postgres receives the query template, plans it, and *then* receives the value. The value
is never parsed as SQL — it lands in a slot already typed as "text". There is no string
for an attacker to break out of, because no string was ever built.

This is why it's not "escaping done well." Escaping tries to neutralize dangerous
characters in a string that will still be parsed. Parameterization means **the value is
never parsed at all**. Different mechanism, categorical difference.

We prove it in `server/api.test.js`:

```js
const payload = "Robert'); drop table habits;--";
// stored, retrieved verbatim, habits table still exists
```

That title round-trips as literal text. In a concatenated query it would have been a
catastrophe.

### The one thing you cannot parameterize

Placeholders work for **values**. They do not work for **identifiers** — table names,
column names, `ORDER BY` directions, `LIMIT` when it's dynamic. This is invalid:

```sql
select * from $1 where $2 = $3     -- no
```

Which matters, because our PATCH routes build SQL dynamically. The rule we follow: column
names come from a **hardcoded allowlist in our own source**, never from the request.

```js
// server/routes/habits.js — the list is ours, the values are theirs
const keys = ['title', 'cadence', 'target_per_week'].filter((k) => req.body[k] !== undefined);
const sets = keys.map((k, i) => `${k} = $${i + 1}`);   // names from our array
db.query(`update habits set ${sets.join(', ')} ...`, [...values, id, req.user.id]);
```

`keys` can only ever contain those three strings. `values` is entirely user-supplied and
travels exclusively through `$n`. The generic `server/routes/_crud.js` does the same with
its `columns` config.

Note that `zod` strips unknown keys before this runs — so even a request with
`{"title; drop table--": 1}` arrives with that key already gone. **Two independent layers,
neither relied on alone.**

### Why we didn't use an ORM

An ORM (Prisma, Sequelize, TypeORM) parameterizes for you, which is a real benefit. We
skipped one deliberately:

- The `pg` driver already gives us parameterization. The vulnerability is closed without it.
- An ORM would hide exactly the SQL this project exists to teach — the streak query in
  concept 04 is not something you'd write through an ORM.
- ORMs aren't automatic immunity anyway. Every one has a raw-query escape hatch
  (`prisma.$queryRawUnsafe`, `sequelize.query`), and that's where the CVEs live.

For a production app with a big team, an ORM's consistency is worth a lot. That's a real
tradeoff, not a wrong answer.

## Where it lives in this repo

Every query in this codebase is parameterized. There are no exceptions, and that's
checkable:

```bash
# any db.query with a template literal containing ${ } would be suspicious
grep -rn 'db.query(`' server --include='*.js' | grep -v node_modules
```

The hits are all multi-line SQL with `$1` placeholders, plus the two dynamic-`SET`
builders described above.

| What | Where |
|---|---|
| Values through `$n`, always | every `db.query` call |
| Dynamic SET from an allowlist | `server/routes/habits.js:96`, `server/routes/_crud.js:46` |
| zod strips unknown keys first | `server/middleware/validate.js:4` |
| Injection test | `server/api.test.js` |

One related habit: user input also reaches the **GitHub URL** in `server/github.js:64`,
where it's wrapped in `encodeURIComponent` and validated against
`/^[a-zA-Z0-9-]{1,39}$/` first. Same principle, different injection target — a username
of `../../orgs/secret` would otherwise change which endpoint we called.

## Try it yourself

```bash
TOKEN=...   # from a login

# try to break out of the string
curl -s -X POST localhost:3000/api/habits \
  -H 'content-type: application/json' -H "Authorization: Bearer $TOKEN" \
  -d '{"title":"Robert'"'"'); drop table habits;--"}'

# the table is still there, and the title is stored literally
curl -s localhost:3000/api/habits -H "Authorization: Bearer $TOKEN"
```

To see the failure mode for real, open `psql` and run the concatenated version by hand:

```sql
create table demo (id serial, name text);
insert into demo (name) values ('alice');
-- what a vulnerable app would send after input:  ' or '1'='1
select * from demo where name = '' or '1'='1';   -- returns everything
drop table demo;
```

## Explain it in 60 seconds

> SQL injection happens when user input gets concatenated into a query string, so the
> database can't tell the difference between the query you wrote and what the user typed.
> Someone submits `' or '1'='1` and suddenly your WHERE clause matches every row.
>
> The fix is parameterized queries. You send the SQL template and the values separately —
> `where email = $1` with the value in an array. The database plans the query first, then
> fills the slot, so the value is never parsed as SQL. It's not escaping done carefully;
> it's the value never being parsed at all.
>
> The one gap is that you can only parameterize values, not identifiers — table names,
> column names. Our PATCH routes build a dynamic SET clause, so the column names come from
> a hardcoded array in our source and only the values come from the request. If you ever
> find yourself putting a user-supplied string where a column name goes, that's the moment
> to stop.
>
> ORMs do this for you, which is a fine reason to use one. We skipped it because it would
> hide the SQL we're trying to learn, and because the driver already parameterizes.

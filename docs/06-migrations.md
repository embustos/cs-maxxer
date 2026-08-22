# 06 — Migrations

## What problem it solves

Your schema changes over time — a new table, a new column, an index. The question is how
that change reaches every database: your laptop, a teammate's laptop, CI, production.

The approaches that fail:

- **Edit the schema by hand in psql.** Works on your machine. Production never gets it,
  or gets it at 2am from memory, slightly differently. Nobody can say what state anything
  is in.
- **One `schema.sql` you keep updating.** Fine for a fresh database; useless for an
  existing one with data in it. You can't re-run `create table` on a live table.

A migration system answers: **what changes have been applied here, and which are left?**

## How it works

Three pieces, and that's genuinely all:

1. **Numbered SQL files**, applied in filename order. `001_initial.sql`, `002_indexes.sql`.
2. **A table recording what ran** — `schema_migrations`, one row per applied file.
3. **A runner** that diffs the two and applies the difference.

Ours is `server/migrate.js`, about 25 lines. Knex, Prisma Migrate, Rails, Django, Flyway,
Alembic — all of them are this, plus rollbacks, plus generators.

```
$ npm run migrate
applied 001_initial.sql
applied 002_indexes.sql
...
5 migration(s) applied

$ npm run migrate
already up to date          ← idempotent: safe to run on every deploy
```

### Each migration is one transaction

`server/migrate.js:29-37`:

```js
await client.query('begin');
await client.query(sql);
await client.query('insert into schema_migrations (name) values ($1)', [file]);
await client.query('commit');
// on error: rollback
```

If a migration fails halfway, everything it did is undone and it is **not** recorded as
applied. Without this you get a database in a state no migration file describes — half a
change, marked as complete or not, and no way to reason about it. Postgres supports
transactional DDL, which many databases (MySQL) do not — there, a failed migration really
can leave you stranded.

### The rule that matters: migrations are append-only

**Never edit a migration that has already run.** It's the single most important rule here,
and this repo demonstrates why with a real mistake.

`002_indexes.sql` created an index that turned out to be redundant with a UNIQUE
constraint (see concept 04). The tempting fix is to edit 002. That would be wrong:

- 002 is already recorded as applied here. Editing it changes **nothing** in this database.
- It's applied in production too. Same story.
- Only a *fresh* database would get the new version — so dev and production silently
  diverge, and the bug appears months later on a new machine.

So `005_fix_indexes.sql` drops the redundant index and adds the right one. 002 stays
wrong, with a comment saying so. **An applied migration is history, not source code.**

The exception: a migration you wrote five minutes ago and haven't pushed. Edit that
freely — nobody else has run it.

### Writing migrations that are safe to re-run

`if not exists` / `if exists` everywhere:

```sql
create table if not exists habits (...);
alter table users add column if not exists github_username text;
drop index if exists completions_habit_date_idx;
```

Belt and braces — the runner already skips applied files, but this makes a file harmless
if it's ever applied to a database that partially has it. That's how `001_initial.sql`
could be introduced onto a database that already had those tables.

### What we skipped, and when you'd want it

- **Down migrations / rollbacks.** Most real rollbacks happen by writing a new forward
  migration, because reversing a `drop column` doesn't bring the data back. Add them when
  you have a staging environment where you genuinely re-run schemas.
- **Zero-downtime patterns.** Renaming a column while old code is still running requires
  the expand/contract dance: add the new column, backfill, deploy code using both, then
  drop the old one. Matters once you have users who'd notice.

## Where it lives in this repo

| What | Where |
|---|---|
| The runner | `server/migrate.js` |
| Ledger table created on first run | `server/migrate.js:12` |
| Diff applied vs. on-disk | `server/migrate.js:18-19` |
| One transaction per migration | `server/migrate.js:26-40` |
| Migration files | `server/migrations/*.sql` |
| The corrective migration | `server/migrations/005_fix_indexes.sql` |
| Runs in CI before tests | `.github/workflows/ci.yml` |

Ordering note: files are applied with `.sort()`, which is why they're zero-padded.
`10_x.sql` sorts before `9_x.sql` as strings — `010_x.sql` doesn't.

## Try it yourself

```bash
cd server && npm run migrate      # "already up to date"

docker exec cs-tracker-db-1 psql -U cstracker -d cs_tracker \
  -c "select * from schema_migrations order by name"
```

Now add one and watch it apply:

```bash
cat > migrations/006_test.sql <<'EOF'
alter table habits add column if not exists color text;
EOF
npm run migrate                   # applied 006_test.sql
npm run migrate                   # already up to date
```

Then prove the whole thing reproduces from nothing:

```bash
docker compose down -v && docker compose up -d    # deletes the database entirely
sleep 5 && cd server && npm run migrate           # rebuilds it from the files
```

That last one is the real test of a migration system: **the schema can be reconstructed
from an empty database with one command.**

## Explain it in 60 seconds

> A migration system answers "what schema changes has this database already had?" You
> keep numbered SQL files, and a table recording which ones ran. The runner compares the
> two and applies the difference, so running it is idempotent — safe on every deploy.
>
> Each migration runs in a transaction, so a failure rolls back completely rather than
> leaving the schema half-changed and unrecorded.
>
> The rule that actually bites people: never edit a migration that has already run.
> Editing it doesn't change any database where it already applied — it only changes what a
> *fresh* database gets, so dev and production silently drift apart. If a migration was
> wrong, you write a new one that corrects it. We did exactly that here: migration 2 added
> an index that turned out to be redundant, and migration 5 drops it. Migration 2 stays
> wrong on purpose, because it's history.
>
> The payoff is that anyone can go from an empty database to the current schema with one
> command, and you can see exactly what changed and when.

# 04 — SQL + indexes

## What problem it solves

Without an index, answering "which completions belong to user 1200?" means Postgres reads
**every row in the table** and throws away the ones that don't match. That's a *sequential
scan*. It's fine at 100 rows and catastrophic at 10 million — and it gets worse silently,
as your app succeeds.

Measured on this repo's schema with ~120,000 seeded rows:

```
                                          rows scanned    time
Seq Scan  (no index)                        120,009      4.047 ms
Bitmap Index Scan (user_id, completed_on)         0      0.045 ms
```

**90× faster**, and the gap widens linearly with table size. At 12 million rows the seq
scan is 400ms; the index scan is still ~0.05ms.

## How it works

An index is a **sorted copy of one or more columns**, kept up to date automatically, with
pointers back to the rows. Postgres's default is a B-tree — a structure that finds any
value in `log(n)` steps instead of `n`. 12 million rows is ~23 steps.

The cost: every `insert`, `update`, and `delete` must also update every index on that
table, and each index takes disk. **Indexes are not free** — index what you actually
query, not everything.

### Column order matters

An index on `(user_id, completed_on)` is a phone book sorted by last name, then first
name. It can answer:

- `where user_id = 5` ✅ (leading column)
- `where user_id = 5 and completed_on > '2026-01-01'` ✅ (leading + next)
- `where completed_on > '2026-01-01'` ❌ — like finding everyone named "James" in a book
  sorted by surname. You're back to scanning.

Rule: **equality filters first, then range filters, then sort columns.**

### The redundancy we actually shipped and then removed

A real finding from building this. Migration 002 added:

```sql
create index completions_habit_date_idx on habit_completions (habit_id, completed_on desc);
```

Then `EXPLAIN ANALYZE` showed the planner using an index called
`habit_completions_habit_id_completed_on_key` — one nobody wrote. It came from this, in
the table definition:

```sql
unique (habit_id, completed_on)
```

**A UNIQUE constraint is enforced by building an index.** Ours duplicated it exactly. The
index was pure cost: extra disk, extra work on every insert, zero benefit. Migration 005
drops it and adds the one that was actually missing — `(user_id, completed_on)`.

The lesson isn't "read more carefully." It's **measure before and after, always**. The
index you assume you need may already exist; the one you need may be somewhere you didn't
look.

### Reading EXPLAIN ANALYZE

`EXPLAIN` shows the plan. `EXPLAIN ANALYZE` actually runs it and shows reality. Read it
**inside out** — the innermost node runs first.

```
Seq Scan on habit_completions (actual time=4.034..4.034 rows=0 loops=1)
  Rows Removed by Filter: 120009        ← the smoking gun
```

`Rows Removed by Filter` far exceeding rows returned means you scanned a pile of data to
throw it away. That's an index waiting to be created.

```
Bitmap Index Scan on completions_user_date_idx (actual time=0.025..0.025 rows=0 loops=1)
  Index Cond: ((user_id = 1200) AND (completed_on > (CURRENT_DATE - 7)))
```

`Index Cond` means the condition was applied *by the index*. That's the win.

One caveat: **Postgres ignores indexes on small tables**, correctly — for 50 rows a seq
scan is genuinely faster than the indirection. Test on realistic data or you'll conclude
your index "doesn't work."

### The streak query: gaps and islands

The one genuinely interesting query in this app. Given a habit's completion dates, how
long is the current unbroken run?

The trick is a classic called **gaps and islands**. For consecutive dates counted
backwards, `date + row_number()` is **constant**:

```
completed_on   row_number   date + rn
2026-08-18         1        2026-08-19  ┐
2026-08-17         2        2026-08-19  ├─ same value = one unbroken island
2026-08-16         3        2026-08-19  ┘
2026-08-13         4        2026-08-17  ← different value = new island, gap found
```

So grouping by that sum collapses each run into one group, and `count(*)` is its length.
No loops, no fetching every row into JavaScript — one query.

The final `where s.newest >= today - 1` is a product decision encoded in SQL: a run
ending *yesterday* still counts, so your streak doesn't read as broken at 9am before
you've done today's.

## Where it lives in this repo

| What | Where |
|---|---|
| The streak query | `server/routes/habits.js:43-73` |
| Indexes as shipped | `server/migrations/002_indexes.sql` |
| The correction, with measurements | `server/migrations/005_fix_indexes.sql` |
| Per-resource indexes | `server/migrations/003_tracker_tables.sql` |
| Streak tests (incl. the gap case) | `server/api.test.js` |

Note `habits_user_idx` is a **partial index**: `where archived_at is null`. It only
indexes rows the app actually queries, so it's smaller and faster than a full one.

## Try it yourself

```bash
docker exec -it cs-tracker-db-1 psql -U cstracker -d cs_tracker
```

```sql
-- see every index on a table
select indexname, indexdef from pg_indexes where tablename = 'habit_completions';

-- watch the planner choose
explain analyze select * from habit_completions where user_id = 1;

-- force a seq scan to compare honestly
set enable_indexscan = off; set enable_bitmapscan = off;
explain analyze select * from habit_completions where user_id = 1;
reset all;
```

Seed a lot of rows first — on a tiny table the planner will pick a seq scan and be right.

## Explain it in 60 seconds

> An index is a sorted copy of some columns with pointers back to the rows. Without one,
> the database reads every row and filters — a sequential scan. With one, it does a binary
> search: `log(n)` instead of `n`. On our table, 120,000 rows scanned at 4ms became an
> index lookup at 0.045ms, 90× faster, and the gap grows with the data.
>
> They're not free — every write has to update every index, and each costs disk. So you
> index what you query. Column order matters: an index on `(user_id, date)` helps a query
> filtering on `user_id`, but not one filtering only on `date`, the same way a phone book
> sorted by surname doesn't help you find every "James".
>
> The way you know is `EXPLAIN ANALYZE`. If you see "Rows Removed by Filter: 120009",
> that's a missing index. We also found the opposite — an index we'd added was already
> being created by a UNIQUE constraint, so it was pure overhead and we dropped it. That's
> the real lesson: measure, don't assume.

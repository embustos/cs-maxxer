-- Correcting 002 by ADDING a migration, never by editing it. 002 has already run on
-- this database (and would have run on a deployed one) — editing it changes nothing
-- that already ran, and silently diverges dev from production. Migrations are append-only.
--
-- Two findings from EXPLAIN ANALYZE on ~120k seeded rows (docs/04-sql-indexes.md):
--
-- 1. completions_habit_date_idx was REDUNDANT. `unique (habit_id, completed_on)` already
--    builds an index on exactly those columns in that order — the planner was using it
--    before 002 ever ran. A redundant index is not free: every insert must update it.
drop index if exists completions_habit_date_idx;

-- 2. The real gap: queries filtering by user_id had no index at all.
--    Seq Scan, 120,009 rows removed by filter, 4.047 ms  ->  Bitmap Index Scan, 0.045 ms
create index if not exists completions_user_date_idx
  on habit_completions (user_id, completed_on desc);

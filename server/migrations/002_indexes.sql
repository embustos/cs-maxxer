-- Every query in this app filters by user_id. Without an index Postgres reads the whole
-- table each time. See docs/04-sql-indexes.md for the EXPLAIN ANALYZE numbers.
--
-- NOTE: the completions index declared here turned out to be redundant with the UNIQUE
-- constraint, and 005_fix_indexes.sql drops it. Left as-written on purpose — an applied
-- migration is history and never gets edited.
create index if not exists habits_user_idx on habits (user_id) where archived_at is null;
create index if not exists completions_habit_date_idx
  on habit_completions (habit_id, completed_on desc);

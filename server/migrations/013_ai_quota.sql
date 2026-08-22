-- A monthly ceiling on paid AI calls, per user.
--
-- middleware/rateLimit.js already caps the RATE, but it lives in an in-process Map:
-- it resets on every deploy and every restart, and it has no notion of a total. With
-- open signups that leaves the Anthropic bill unbounded. This is the cumulative cap,
-- and it belongs in the database precisely because the database survives a restart.
--
-- Two columns instead of an ai_calls event table: the only question ever asked is
-- "how many this month?", and a counter answers it in the same UPDATE that increments
-- it. Add the event table when you want per-call analytics, not before.
alter table users
  add column if not exists ai_calls  integer not null default 0,
  add column if not exists ai_period date    not null default date_trunc('month', now())::date;

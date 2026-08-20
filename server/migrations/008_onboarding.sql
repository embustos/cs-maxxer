-- Set once the user has been through (or skipped) the survey, so we never ask twice.
-- Nullable: every existing account is treated as not-yet-onboarded and will see it once.
alter table users add column if not exists onboarded_at timestamptz;

-- How often they want the digest to nudge them. Feeds jobs/digest.js.
alter table users add column if not exists reminder_cadence text
  check (reminder_cadence is null or reminder_cadence in ('daily', 'weekly', 'off'));

-- How many commits a day the user is aiming for. Nullable: the arc meter only appears
-- once they've set one, so the feature is opt-in.
alter table users add column if not exists daily_commit_goal integer
  check (daily_commit_goal is null or daily_commit_goal between 1 and 50);

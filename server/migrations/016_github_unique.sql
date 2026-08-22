-- One GitHub account per cs maxxer account. Without this, two users could both point at
-- the same GitHub profile — harmless for the commit graph, but it breaks the future
-- leaderboard/friends premise where a GitHub identity is supposed to mean one person.
--
-- Partial: null means "not connected", and many rows may be that at once.
-- lower(): GitHub usernames are case-insensitive, so EmiBustos and emibustos are the
-- same account and must collide here too.
create unique index if not exists users_github_lower_key
  on users (lower(github_username)) where github_username is not null;

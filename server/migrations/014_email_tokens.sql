-- Password reset and email verification are the same machinery — a random token, mailed
-- as a link, single use, expiring — so they share one table and one code path.
--
-- The column is token_HASH. Storing the raw token would mean a read-only leak of this
-- table hands out account takeover for every pending reset, which is the same reason
-- users.password_hash exists rather than users.password.
create table if not exists email_tokens (
  token_hash text primary key,
  user_id    integer not null references users(id) on delete cascade,
  purpose    text not null check (purpose in ('reset', 'verify')),
  expires_at timestamptz not null,
  used_at    timestamptz,
  created_at timestamptz not null default now()
);

-- Issuing a new token invalidates the user's outstanding ones of the same purpose, which
-- is a delete by (user_id, purpose) on every request to /auth/forgot.
create index if not exists email_tokens_user_purpose_idx on email_tokens (user_id, purpose);

-- Null means unverified. Nothing blocks login on this — it gates one thing only, in
-- jobs/digest.js: we never email an address nobody has proven they can read.
alter table users add column if not exists email_verified_at timestamptz;

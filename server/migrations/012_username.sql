-- Display identity, separate from the login identity. Email is how you sign in; it is
-- not something you want rendered in a header, and it is certainly not what goes on a
-- leaderboard next to other people.
--
-- Nullable first, backfill, then NOT NULL — adding it NOT NULL in one step would fail
-- against any existing row.
alter table users add column username text;

-- Derive from the email local part: strip anything outside the allowed set, pad short
-- results, and de-duplicate with row_number so two people who happen to share a local
-- part across domains ("me@a.edu" / "me@b.com") don't collide.
with derived as (
  select id,
         left(regexp_replace(split_part(email, '@', 1), '[^a-zA-Z0-9_]', '', 'g'), 20) as base,
         row_number() over (
           partition by left(regexp_replace(split_part(email, '@', 1), '[^a-zA-Z0-9_]', '', 'g'), 20)
           order by id
         ) as n
    from users
)
update users u
   set username = case
                    when length(d.base) < 3 then 'user' || u.id
                    when d.n = 1             then d.base
                    else left(d.base, 16) || d.n
                  end
  from derived d
 where d.id = u.id;

alter table users alter column username set not null;

-- Case-insensitive uniqueness: "Emiliano" and "emiliano" must not be two accounts, or
-- impersonation on a future leaderboard is trivial. A functional unique index does this
-- without needing the citext extension installed.
create unique index users_username_lower_key on users (lower(username));

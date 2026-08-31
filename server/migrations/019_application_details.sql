-- The board says where an application stands. These are the things you actually need
-- when the recruiter finally emails back three weeks later and you remember nothing.
--
-- All nullable text, no backfill: an unfilled column on an old row is indistinguishable
-- from an unfilled column on a new one, which is the honest state either way.
alter table applications add column if not exists company_size text;
alter table applications add column if not exists location     text;
-- How you found it — referral, careers page, a friend's Slack. The thing that worked
-- once is the thing to do again, and it's the first detail anyone forgets.
alter table applications add column if not exists source       text;
alter table applications add column if not exists requirements text;
alter table applications add column if not exists recruiter    text;
-- People at the company who are NOT the recruiter. Free text on purpose: the
-- connections table is for relationships you maintain over time, this is a scratch
-- note about who you happen to know here. ponytail: promote to a join table only if
-- these ever need to be queried across applications.
alter table applications add column if not exists contacts     text;
alter table applications add column if not exists documents    text;

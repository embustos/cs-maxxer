-- People worth staying in touch with, what you've said to them, and what you learned.
create table if not exists connections (
  id                serial primary key,
  user_id           integer not null references users(id) on delete cascade,
  name              text not null,
  company           text,
  role              text,
  relationship      text not null default 'other'
                    check (relationship in ('recruiter','engineer','alum','professor','peer','manager','other')),
  linkedin_url      text,
  email             text,
  met_at            text,          -- free text: "ACM career fair", "referred by Dana"
  last_contacted_on date,
  follow_up_on      date,          -- drives the "reach out" nudge on the dashboard
  created_at        timestamptz not null default now(),
  archived_at       timestamptz
);
create index if not exists connections_user_idx on connections (user_id) where archived_at is null;
-- The dashboard asks "who is due?" — that query filters by user and sorts by date.
create index if not exists connections_followup_idx on connections (user_id, follow_up_on)
  where archived_at is null and follow_up_on is not null;

create table if not exists connection_notes (
  id            serial primary key,
  connection_id integer not null references connections(id) on delete cascade,
  user_id       integer not null references users(id) on delete cascade,
  body          text not null,
  created_at    timestamptz not null default now()
);
create index if not exists connection_notes_idx on connection_notes (connection_id, created_at desc);

create table if not exists outreach_messages (
  id            serial primary key,
  connection_id integer not null references connections(id) on delete cascade,
  user_id       integer not null references users(id) on delete cascade,
  channel       text not null default 'linkedin'
                check (channel in ('linkedin','email','other')),
  draft         text not null,
  -- The last AI review, cached on the row. Reopening a draft must not re-bill an API call.
  review_json   jsonb,
  reviewed_at   timestamptz,
  sent_at       timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists outreach_messages_idx on outreach_messages (connection_id, created_at desc);

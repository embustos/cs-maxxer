-- The rest of cs-tracker: where you applied, what is coming up, what you are aiming at.
create table if not exists applications (
  id         serial primary key,
  user_id    integer not null references users(id) on delete cascade,
  company    text not null,
  role       text not null,
  stage      text not null default 'applied'
             check (stage in ('applied','oa','interview','offer','rejected','ghosted')),
  applied_on date not null default current_date,
  url        text,
  notes      text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists applications_user_idx on applications (user_id, applied_on desc);

create table if not exists events (
  id        serial primary key,
  user_id   integer not null references users(id) on delete cascade,
  title     text not null,
  kind      text not null default 'other'
            check (kind in ('club','career_fair','conference','networking','deadline','other')),
  starts_at timestamptz not null,
  location  text,
  url       text,
  attended  boolean not null default false
);
create index if not exists events_user_idx on events (user_id, starts_at);

create table if not exists goals (
  id      serial primary key,
  user_id integer not null references users(id) on delete cascade,
  title   text not null,
  target  integer not null check (target > 0),
  current integer not null default 0 check (current >= 0),
  due_on  date
);
create index if not exists goals_user_idx on goals (user_id);

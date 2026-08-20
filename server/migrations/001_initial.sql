-- The tables that already existed before migrations were introduced. Written with
-- "if not exists" so it is a no-op on the dev database that already has them.
create table if not exists users (
  id            serial primary key,
  email         text not null unique,
  password_hash text not null,
  created_at    timestamptz not null default now()
);

create table if not exists habits (
  id              serial primary key,
  user_id         integer not null references users(id) on delete cascade,
  title           text not null,
  cadence         text not null default 'daily' check (cadence in ('daily', 'weekly')),
  target_per_week integer not null default 7 check (target_per_week between 1 and 7),
  created_at      timestamptz not null default now(),
  archived_at     timestamptz
);

create table if not exists habit_completions (
  id           serial primary key,
  habit_id     integer not null references habits(id) on delete cascade,
  user_id      integer not null references users(id) on delete cascade,
  completed_on date not null default current_date,
  created_at   timestamptz not null default now(),
  unique (habit_id, completed_on)
);

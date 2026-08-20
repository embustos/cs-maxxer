-- STAR answers you can reuse across interviews.
--
-- Situation/Task/Action/Result are separate columns rather than one blob: the whole point
-- of the framework is that each part is distinct, and separate fields let the UI prompt
-- for each one and show you which part you skipped.
create table if not exists interview_answers (
  id             serial primary key,
  user_id        integer not null references users(id) on delete cascade,
  -- Optional link to a specific application. Null means it's a general-purpose answer,
  -- which is the common case — most STAR stories get reused.
  application_id integer references applications(id) on delete set null,
  question       text not null,
  situation      text,
  task           text,
  action         text,
  result         text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists interview_answers_user_idx on interview_answers (user_id, updated_at desc);

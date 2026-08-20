-- interview_answers orders by updated_at, but the generic CRUD route never sets it — so
-- an edited answer would keep its original timestamp and never rise to the top.
--
-- A column that must always reflect the last write belongs to the database, not to every
-- route that happens to touch the table. A trigger cannot be forgotten by a new caller.
create or replace function touch_updated_at() returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists interview_answers_touch on interview_answers;
create trigger interview_answers_touch
  before update on interview_answers
  for each row execute function touch_updated_at();

-- applications has the same column and the same gap.
drop trigger if exists applications_touch on applications;
create trigger applications_touch
  before update on applications
  for each row execute function touch_updated_at();

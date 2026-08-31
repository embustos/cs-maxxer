-- A conference is not a moment. An event can now carry an end, and a kind of 'other'
-- can carry the word the user actually meant ("Hackathon", "Info session").
--
-- Both nullable, no backfill: null ends_at means a single-day event and null kind_label
-- means the stock label — which is exactly what every existing row is.
alter table events add column if not exists ends_at    timestamptz;
alter table events add column if not exists kind_label text;

-- The one rule the client must not be trusted with. A PATCH that moves starts_at past
-- ends_at never reaches zod's create-time refinement, so the guarantee lives here.
alter table events drop constraint if exists events_span_check;
alter table events add constraint events_span_check check (ends_at is null or ends_at >= starts_at);

-- 008 added onboarded_at as nullable, which means every account that existed before it
-- ran reads as "never onboarded" and would be shown a first-run setup survey despite
-- already having a populated dashboard.
--
-- Anyone who has already created something has demonstrably done the setup. Mark them
-- onboarded so the survey only ever meets genuinely new accounts.
--
-- Appending rather than editing 008: it has already run here, so an edit would change
-- nothing on this database and silently diverge it from a fresh one.
update users u
   set onboarded_at = coalesce(u.onboarded_at, u.created_at),
       reminder_cadence = coalesce(u.reminder_cadence, 'weekly')
 where u.onboarded_at is null
   and (exists (select 1 from habits       h where h.user_id = u.id)
     or exists (select 1 from goals        g where g.user_id = u.id)
     or exists (select 1 from applications a where a.user_id = u.id)
     or exists (select 1 from connections  c where c.user_id = u.id));

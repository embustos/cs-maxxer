const express = require('express');
const db = require('../db');
const requireAuth = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

const DATE = /^\d{4}-\d{2}-\d{2}$/;

// This week vs the week before, for everything the app tracks. No new tables — it's all
// aggregation over rows that already exist.
//
// "This week" is anchored to the browser's date for the same reason done_today is: the
// database runs UTC, so at 5pm Pacific its idea of the week can already be tomorrow's.
router.get('/weekly', async (req, res) => {
  const today = DATE.test(req.query.today ?? '') ? req.query.today : null;
  if (req.query.today && !today) {
    return res.status(400).json({ error: 'today must look like YYYY-MM-DD' });
  }

  const { rows } = await db.query(
    `with ref as (select coalesce($2::date, current_date) as today),
     bounds as (
       select today,
              today - 6  as this_start,
              today - 13 as prev_start,
              today - 7  as prev_end
         from ref
     )
     select
       (select count(*) from habit_completions c, bounds b
         where c.user_id = $1 and c.completed_on between b.this_start and b.today)::int as habits_this,
       (select count(*) from habit_completions c, bounds b
         where c.user_id = $1 and c.completed_on between b.prev_start and b.prev_end)::int as habits_prev,

       (select count(*) from applications a, bounds b
         where a.user_id = $1 and a.applied_on between b.this_start and b.today)::int as applications_this,
       (select count(*) from applications a, bounds b
         where a.user_id = $1 and a.applied_on between b.prev_start and b.prev_end)::int as applications_prev,

       (select count(*) from events e, bounds b
         where e.user_id = $1 and e.attended
           and e.starts_at::date between b.this_start and b.today)::int as events_this,
       (select count(*) from events e, bounds b
         where e.user_id = $1 and e.attended
           and e.starts_at::date between b.prev_start and b.prev_end)::int as events_prev,

       (select count(*) from outreach_messages m, bounds b
         where m.user_id = $1 and m.sent_at::date between b.this_start and b.today)::int as outreach_this,
       (select count(*) from outreach_messages m, bounds b
         where m.user_id = $1 and m.sent_at::date between b.prev_start and b.prev_end)::int as outreach_prev,

       (select b.this_start from bounds b) as week_start,
       (select b.today from bounds b) as week_end`,
    [req.user.id, today],
  );

  const r = rows[0];
  const metric = (label, now, before) => ({
    label,
    value: now,
    previous: before,
    delta: now - before,
  });

  res.json({
    week_start: r.week_start,
    week_end: r.week_end,
    metrics: [
      metric('Habits completed', r.habits_this, r.habits_prev),
      metric('Applications sent', r.applications_this, r.applications_prev),
      metric('Events attended', r.events_this, r.events_prev),
      metric('Messages sent', r.outreach_this, r.outreach_prev),
    ],
  });
});

module.exports = router;

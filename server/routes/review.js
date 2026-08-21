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
// Exported for /api/bootstrap, same reason as listHabits.
async function weeklyReview(userId, today) {
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
    [userId, today],
  );

  const r = rows[0];
  const metric = (key, label, now, before, weight, advice) => ({
    key,
    label,
    value: now,
    previous: before,
    delta: now - before,
    weight,
    advice,
  });

  // Weights reflect how much each activity actually moves a job search, not how easy
  // it is to do. Sending an application or a message is worth more than ticking a box.
  const metrics = [
    metric('habits', 'Habits completed', r.habits_this, r.habits_prev, 1,
      'Pick the one habit you keep skipping and do it today.'),
    metric('applications', 'Applications sent', r.applications_this, r.applications_prev, 4,
      'Send one application today — momentum here matters more than polish.'),
    metric('events', 'Events attended', r.events_this, r.events_prev, 3,
      'Find one event this week and put it on the calendar.'),
    metric('outreach', 'Messages sent', r.outreach_this, r.outreach_prev, 3,
      'Message one person you already know. Warm beats cold.'),
  ];

  const score = (field) => metrics.reduce((sum, m) => sum + m[field] * m.weight, 0);
  const now = score('value');
  const before = score('previous');

  // The verdict is a rule over numbers we already have — no AI call, so it costs
  // nothing, returns instantly, and cannot invent a wrong priority.
  const worst = [...metrics].sort((a, b) => a.delta * a.weight - b.delta * b.weight)[0];
  const allZero = metrics.every((m) => m.value === 0);

  let verdict;
  if (allZero) {
    verdict = { tone: 'quiet', headline: 'Nothing logged this week.', next: 'Check off one habit — starting again is the whole job.' };
  } else if (now > before) {
    verdict = { tone: 'up', headline: 'You did more than last week.', next: worst.delta < 0 ? worst.advice : 'Keep the streak going — same again next week.' };
  } else if (now === before) {
    verdict = { tone: 'flat', headline: 'Level with last week.', next: worst.advice };
  } else {
    verdict = { tone: 'down', headline: 'Slower than last week.', next: worst.advice };
  }

  return {
    week_start: r.week_start,
    week_end: r.week_end,
    metrics,
    momentum: { score: now, previous: before, delta: now - before },
    verdict,
  };
}

router.get('/weekly', async (req, res) => {
  const today = DATE.test(req.query.today ?? '') ? req.query.today : null;
  if (req.query.today && !today) {
    return res.status(400).json({ error: 'today must look like YYYY-MM-DD' });
  }
  res.json(await weeklyReview(req.user.id, today));
});

module.exports = router;
module.exports.weeklyReview = weeklyReview;

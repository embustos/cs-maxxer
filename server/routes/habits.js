const express = require('express');
const db = require('../db');
const requireAuth = require('../middleware/auth');
const validate = require('../middleware/validate');
const { habitCreate, habitUpdate } = require('../schemas');

const router = express.Router();

// Applies to EVERY route in this file. No habit is reachable without a valid token,
// and req.user.id is what scopes every query below to the person who asked.
router.use(requireAuth);

const DATE = /^\d{4}-\d{2}-\d{2}$/;

// req.params values are always strings. "abc" would reach Postgres and blow up as a
// 500; a bad id is really just "no such habit", so normalize it here.
const asId = (v) => (/^\d+$/.test(v) ? Number(v) : null);

// GET /api/habits[?today=YYYY-MM-DD] — everything this user is tracking, plus
// whether it's done today.
//
// "Today" is the browser's, not the database's. The DB runs in UTC, so at 5pm in
// California `current_date` is already tomorrow — you'd check a habit off and watch
// it stay unchecked. The client knows its own date, so it says so.
router.get('/', async (req, res) => {
  const today = req.query.today;
  if (today !== undefined && !DATE.test(today)) {
    return res.status(400).json({ error: 'today must look like YYYY-MM-DD' });
  }

  // The streak is the interesting part. The trick — "gaps and islands" — is that for
  // consecutive dates, (date - row_number) is CONSTANT. Number the completions newest
  // first, subtract, and every unbroken run collapses to a single group:
  //
  //     date        rn   date - rn
  //     2026-08-18   1   2026-08-17  ┐ same value = one unbroken streak
  //     2026-08-17   2   2026-08-15  │  (wait — see below)
  //     2026-08-16   3   2026-08-13  ┘
  //
  // Counting backwards, consecutive days give date + rn constant instead. We take the
  // group anchored at today (or yesterday, so an unfinished day doesn't zero it out).
  const { rows } = await db.query(
    `with ref as (select coalesce($2::date, current_date) as today),
     numbered as (
       select c.habit_id, c.completed_on,
              c.completed_on + (row_number() over (partition by c.habit_id
                                                   order by c.completed_on desc))::int as grp
         from habit_completions c, ref
        where c.user_id = $1 and c.completed_on <= ref.today
     ),
     streaks as (
       select habit_id, count(*) as len, max(completed_on) as newest
         from numbered group by habit_id, grp
     )
     select h.id, h.title, h.cadence, h.target_per_week, h.created_at,
            (done.habit_id is not null) as done_today,
            -- only counts if the run reaches today or yesterday
            coalesce((select s.len from streaks s
                       where s.habit_id = h.id
                         and s.newest >= (select today from ref) - 1
                       order by s.newest desc limit 1), 0)::int as streak,
            coalesce((select count(*) from habit_completions c2
                       where c2.habit_id = h.id
                         and c2.completed_on > (select today from ref) - 7), 0)::int as last_7_days
       from habits h
       left join habit_completions done
              on done.habit_id = h.id and done.completed_on = (select today from ref)
      where h.user_id = $1 and h.archived_at is null
      order by h.created_at`,
    [req.user.id, today ?? null],
  );
  res.json({ habits: rows });
});

// POST /api/habits — create. POST is NOT idempotent: send it twice, get two habits.
router.post('/', validate(habitCreate), async (req, res) => {
  const { title, cadence, target_per_week } = req.body; // already trimmed + defaulted
  const { rows } = await db.query(
    `insert into habits (user_id, title, cadence, target_per_week)
     values ($1, $2, $3, $4)
     returning id, title, cadence, target_per_week, created_at`,
    [req.user.id, title, cadence, target_per_week],
  );
  // 201 Created + Location header pointing at the thing that now exists.
  res.status(201).location(`/api/habits/${rows[0].id}`).json({ habit: rows[0] });
});

// PATCH /api/habits/:id — partial update. PATCH sends only what changed;
// PUT would mean "replace the whole habit with this".
router.patch('/:id', validate(habitUpdate), async (req, res) => {
  const id = asId(req.params.id);
  if (id === null) return res.status(404).json({ error: 'habit not found' });

  // Column names can never come from user input — they can't be parameterized, so they
  // come from this fixed list. Only the VALUES are user-supplied, and only through $n.
  const keys = ['title', 'cadence', 'target_per_week'].filter((k) => req.body[k] !== undefined);
  if (!keys.length) return res.status(400).json({ error: 'nothing to update' });

  const values = keys.map((k) => req.body[k]);
  const sets = keys.map((k, i) => `${k} = $${i + 1}`);
  const { rows } = await db.query(
    `update habits set ${sets.join(', ')}
      where id = $${values.length + 1} and user_id = $${values.length + 2}
      returning id, title, cadence, target_per_week, created_at`,
    [...values, id, req.user.id],
  );
  // No row = either it doesn't exist, or it isn't yours. Both answer 404: a 403 would
  // confirm the habit exists, which tells a stranger something.
  if (!rows[0]) return res.status(404).json({ error: 'habit not found' });
  res.json({ habit: rows[0] });
});

// DELETE /api/habits/:id — 204 No Content: it worked, there's nothing to send back.
router.delete('/:id', async (req, res) => {
  const id = asId(req.params.id);
  if (id === null) return res.status(404).json({ error: 'habit not found' });

  const { rowCount } = await db.query('delete from habits where id = $1 and user_id = $2', [
    id,
    req.user.id,
  ]);
  if (!rowCount) return res.status(404).json({ error: 'habit not found' });
  res.status(204).end();
});

// PUT /api/habits/:id/completions/:date — "this habit is done on this date."
// PUT because it's idempotent: run it five times and the world looks identical.
// That's the difference from POST, and it's why a flaky connection can safely retry.
router.put('/:id/completions/:date', async (req, res) => {
  const id = asId(req.params.id);
  if (id === null) return res.status(404).json({ error: 'habit not found' });
  if (!DATE.test(req.params.date)) {
    return res.status(400).json({ error: 'date must look like YYYY-MM-DD' });
  }

  const owned = await db.query('select 1 from habits where id = $1 and user_id = $2', [
    id,
    req.user.id,
  ]);
  if (!owned.rowCount) return res.status(404).json({ error: 'habit not found' });

  await db.query(
    `insert into habit_completions (habit_id, user_id, completed_on)
     values ($1, $2, $3::date)
     on conflict (habit_id, completed_on) do nothing`,
    [id, req.user.id, req.params.date],
  );
  res.status(204).end();
});

// DELETE the same URL — unchecking. Also idempotent: deleting twice is still "not done".
router.delete('/:id/completions/:date', async (req, res) => {
  const id = asId(req.params.id);
  if (id === null) return res.status(404).json({ error: 'habit not found' });
  if (!DATE.test(req.params.date)) {
    return res.status(400).json({ error: 'date must look like YYYY-MM-DD' });
  }

  await db.query(
    'delete from habit_completions where habit_id = $1 and user_id = $2 and completed_on = $3::date',
    [id, req.user.id, req.params.date],
  );
  res.status(204).end();
});

module.exports = router;

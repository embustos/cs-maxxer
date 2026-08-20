const express = require('express');
const db = require('../db');
const requireAuth = require('../middleware/auth');
const validate = require('../middleware/validate');
const { onboarding } = require('../schemas');

const router = express.Router();
router.use(requireAuth);

router.get('/', async (req, res) => {
  const { rows } = await db.query(
    'select onboarded_at, reminder_cadence from users where id = $1',
    [req.user.id],
  );
  res.json({ onboarded: Boolean(rows[0]?.onboarded_at), reminder_cadence: rows[0]?.reminder_cadence ?? null });
});

router.post('/', validate(onboarding), async (req, res) => {
  const { habits, goals, reminder_cadence, github_username } = req.body;

  // One transaction for the whole survey. A half-written onboarding — habits created,
  // goals missing, flag set — would leave a dashboard nobody can explain and no way to
  // redo it. Same reasoning as the migration runner in docs/06-migrations.md, applied
  // to app data: it all lands or none of it does.
  const client = await db.connect();
  try {
    await client.query('begin');

    // Guard inside the transaction: a double-submit (double click, retried request)
    // must not create two sets of starter habits.
    const { rows: existing } = await client.query(
      'select onboarded_at from users where id = $1 for update',
      [req.user.id],
    );
    if (existing[0]?.onboarded_at) {
      await client.query('rollback');
      return res.status(409).json({ error: 'already onboarded' });
    }

    for (const title of habits) {
      await client.query('insert into habits (user_id, title) values ($1, $2)', [req.user.id, title]);
    }
    for (const goal of goals) {
      await client.query(
        'insert into goals (user_id, title, target, due_on) values ($1, $2, $3, $4)',
        [req.user.id, goal.title, goal.target, goal.due_on ?? null],
      );
    }

    await client.query(
      `update users set onboarded_at = now(), reminder_cadence = $1,
              github_username = coalesce($2, github_username)
        where id = $3`,
      [reminder_cadence, github_username ?? null, req.user.id],
    );

    await client.query('commit');
    res.status(201).json({ created: { habits: habits.length, goals: goals.length } });
  } catch (err) {
    await client.query('rollback');
    throw err;
  } finally {
    client.release();
  }
});

// Skipping still marks them onboarded — otherwise they'd be asked on every login.
router.post('/skip', async (req, res) => {
  await db.query(
    'update users set onboarded_at = now(), reminder_cadence = coalesce(reminder_cadence, $1) where id = $2',
    ['weekly', req.user.id],
  );
  res.status(204).end();
});

module.exports = router;

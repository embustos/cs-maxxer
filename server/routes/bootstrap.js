// Everything the dashboard needs to draw its first frame, in one response.
//
// The client used to ask for the user, then — once that answered — fire eight more
// requests. Three serial round trips before anything appeared, and eight of those nine
// requests queued behind Chrome's six-connections-per-origin limit on HTTP/1.1.
//
// The queries here are the SAME functions the individual routes use, not copies. Those
// routes stay: they're what the app calls after a mutation, and re-fetching one list is
// cheaper than re-fetching all of them.
//
// ponytail: GitHub is deliberately NOT in here. It's an upstream HTTP call that takes
// ~600ms cold, and bundling it would hold the whole payload hostage to a third party
// being slow. It stays a separate request the dashboard renders around.
const express = require('express');
const db = require('../db');
const requireAuth = require('../middleware/auth');
const { MONTHLY_CAP } = require('../middleware/aiQuota');
const { listHabits } = require('./habits');
const { weeklyReview } = require('./review');
const applications = require('./applications');
const events = require('./events');
const goals = require('./goals');
const connections = require('./connections');
const interviews = require('./interviews');

const router = express.Router();
router.use(requireAuth);

const DATE = /^\d{4}-\d{2}-\d{2}$/;

router.get('/', async (req, res) => {
  const today = req.query.today;
  if (today !== undefined && !DATE.test(today)) {
    return res.status(400).json({ error: 'today must look like YYYY-MM-DD' });
  }
  const id = req.user.id;

  // Concurrent, not sequential — the pool has room and none of these depend on another.
  const [user, habits, apps, evs, gls, cxns, ivs, weekly] = await Promise.all([
    db.query(
      'select id, email, username, github_username, daily_commit_goal, onboarded_at, reminder_cadence, email_verified_at, ai_calls, ai_credits from users where id = $1',
      [id],
    ).then((r) => r.rows[0]),
    listHabits(id, today),
    applications.list(id),
    events.list(id),
    goals.list(id),
    connections.list(id),
    interviews.list(id),
    weeklyReview(id, today ?? null),
  ]);

  // Same reason /auth/me does this: a signature that verifies doesn't prove the account
  // still exists. Falling back to the token's claims would keep a deleted user logged in.
  if (!user) return res.status(401).json({ error: 'account no longer exists' });

  res.json({
    // The cap is server config, not a column — sent along so the client never hardcodes
    // a number that an env var can change out from under it.
    user: { ...user, ai_monthly_cap: MONTHLY_CAP },
    habits,
    applications: apps,
    events: evs,
    goals: gls,
    connections: cxns,
    interview_answers: ivs,
    weekly,
  });
});

module.exports = router;

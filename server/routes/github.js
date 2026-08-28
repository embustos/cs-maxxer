const express = require('express');
const db = require('../db');
const requireAuth = require('../middleware/auth');
const rateLimit = require('../middleware/rateLimit');
const { githubUsername, dailyCommitGoal } = require('../schemas');
const { getCommitActivity } = require('../github');

const router = express.Router();
router.use(requireAuth);

// Our own budget on top of GitHub's. Cached responses are cheap, but a user hammering
// refresh with cache misses would burn the shared rate limit for everyone.
const githubLimit = rateLimit({
  capacity: 10,
  refillPerSec: 10 / 60, // 10 per minute sustained, burst of 10
  key: (req) => `gh:${req.user.id}`,
  message: 'slow down — GitHub data refreshes itself in the background anyway',
});

// A forced refresh ALWAYS costs a GitHub call; a normal read almost never does. Sharing
// one budget between them would let a single account spend 600 calls/hour on the token
// every account shares, so forced refreshes get their own, much smaller bucket.
const refreshLimit = rateLimit({
  capacity: 3,
  refillPerSec: 3 / 60,
  key: (req) => `gh:refresh:${req.user.id}`,
  message: 'GitHub refreshes are limited to a few per minute',
});

const forced = (req) => req.query.refresh === '1';
const maybeRefreshLimit = (req, res, next) => (forced(req) ? refreshLimit(req, res, next) : next());

router.put('/username', async (req, res) => {
  const parsed = githubUsername.safeParse(req.body?.username ?? '');
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
  try {
    await db.query('update users set github_username = $1 where id = $2', [parsed.data, req.user.id]);
  } catch (err) {
    // One GitHub identity per account (migration 016) — on the future leaderboard a
    // GitHub graph is supposed to mean one person, not whoever typed the name first.
    if (err.code === '23505') {
      return res.status(409).json({ error: 'that GitHub account is already connected to another cs maxxer account' });
    }
    throw err;
  }
  res.json({ github_username: parsed.data });
});

router.delete('/username', async (req, res) => {
  await db.query('update users set github_username = null where id = $1', [req.user.id]);
  res.status(204).end();
});

// The daily commit target the arc meter fills toward.
router.put('/goal', async (req, res) => {
  const parsed = dailyCommitGoal.safeParse(req.body?.goal);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
  await db.query('update users set daily_commit_goal = $1 where id = $2', [parsed.data, req.user.id]);
  res.json({ daily_commit_goal: parsed.data });
});

router.delete('/goal', async (req, res) => {
  await db.query('update users set daily_commit_goal = null where id = $1', [req.user.id]);
  res.status(204).end();
});

router.get('/activity', githubLimit, maybeRefreshLimit, async (req, res, next) => {
  const { rows } = await db.query(
    'select github_username, daily_commit_goal from users where id = $1',
    [req.user.id],
  );
  const username = rows[0]?.github_username;
  const goal = rows[0]?.daily_commit_goal ?? null;
  if (!username) return res.json({ connected: false, daily_commit_goal: goal });

  // "Today" is the browser's, not the server's — same reasoning as the habits route.
  const today = /^\d{4}-\d{2}-\d{2}$/.test(req.query.today ?? '')
    ? req.query.today
    : new Date().toISOString().slice(0, 10);

  try {
    const activity = await getCommitActivity(username, { force: forced(req) });
    res.json({
      connected: true,
      daily_commit_goal: goal,
      today,
      today_count: activity.days?.[today] ?? 0,
      ...activity,
    });
  } catch (err) {
    // An upstream failure is not OUR 500 — say who broke and let the UI degrade.
    if (err.status) return res.status(err.status === 404 ? 404 : 502).json({ error: err.message });
    next(err);
  }
});

module.exports = router;

const express = require('express');
const db = require('../db');
const requireAuth = require('../middleware/auth');
const rateLimit = require('../middleware/rateLimit');
const { githubUsername } = require('../schemas');
const { getCommitActivity } = require('../github');

const router = express.Router();
router.use(requireAuth);

// Our own budget on top of GitHub's. Cached responses are cheap, but a user hammering
// refresh with cache misses would burn the shared rate limit for everyone.
const githubLimit = rateLimit({
  capacity: 10,
  refillPerSec: 10 / 60, // 10 per minute sustained, burst of 10
  key: (req) => `gh:${req.user.id}`,
  message: 'slow down — GitHub data refreshes every 15 minutes anyway',
});

router.put('/username', async (req, res) => {
  const parsed = githubUsername.safeParse(req.body?.username ?? '');
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
  await db.query('update users set github_username = $1 where id = $2', [parsed.data, req.user.id]);
  res.json({ github_username: parsed.data });
});

router.delete('/username', async (req, res) => {
  await db.query('update users set github_username = null where id = $1', [req.user.id]);
  res.status(204).end();
});

router.get('/activity', githubLimit, async (req, res, next) => {
  const { rows } = await db.query('select github_username from users where id = $1', [req.user.id]);
  const username = rows[0]?.github_username;
  if (!username) return res.json({ connected: false });

  try {
    res.json({ connected: true, ...(await getCommitActivity(username)) });
  } catch (err) {
    // An upstream failure is not OUR 500 — say who broke and let the UI degrade.
    if (err.status) return res.status(err.status === 404 ? 404 : 502).json({ error: err.message });
    next(err);
  }
});

module.exports = router;

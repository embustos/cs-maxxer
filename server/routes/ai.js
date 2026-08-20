const express = require('express');
const db = require('../db');
const requireAuth = require('../middleware/auth');
const validate = require('../middleware/validate');
const rateLimit = require('../middleware/rateLimit');
const ai = require('../ai');
const { buildMessageReview, buildResumeReview } = require('../prompts');
const { messageReview, resumeReview } = require('../schemas');

const router = express.Router();
router.use(requireAuth);

// Every request through here spends real money, so this is the first rate limit in the
// app that protects the wallet rather than the server. 15 reviews, refilling one every
// 20 seconds — invisible while working, a hard ceiling on a runaway loop or a stuck
// retry in the UI. See docs/11-rate-limiting.md.
const aiLimit = rateLimit({
  capacity: 15,
  refillPerSec: 1 / 20,
  key: (req) => `ai:${req.user.id}`,
  message: 'Too many reviews in a short window — each one costs an API call.',
});

// Lets the client render "here's how to turn this on" instead of a dead button.
router.get('/status', (req, res) => res.json({ configured: ai.isConfigured() }));

router.post('/review-message', aiLimit, validate(messageReview), async (req, res, next) => {
  const { draft, channel, connection_id } = req.body;

  // Context makes the review specific rather than generic — but only from rows this
  // user owns. A connection_id belonging to someone else simply contributes nothing.
  let connection = null;
  if (connection_id) {
    const { rows } = await db.query(
      `select c.name, c.company, c.role, c.relationship, c.met_at,
              coalesce(array_agg(n.body order by n.created_at desc)
                       filter (where n.body is not null), '{}') as notes
         from connections c
         left join connection_notes n on n.connection_id = c.id
        where c.id = $1 and c.user_id = $2
        group by c.id`,
      [connection_id, req.user.id],
    );
    connection = rows[0] ?? null;
  }

  try {
    const { result, usage } = await ai.complete(buildMessageReview({ draft, channel, connection }));
    res.json({ review: result, usage });
  } catch (err) {
    // An upstream or configuration problem is not our 500 — say who broke and let the
    // UI degrade with a message the user can act on.
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  }
});

// Reviews a saved draft and caches the result on the row, so reopening it later costs
// nothing. Editing the draft clears the cache (see routes/connections.js).
router.post('/review-message/:messageId', aiLimit, async (req, res, next) => {
  const messageId = /^\d+$/.test(req.params.messageId) ? Number(req.params.messageId) : null;
  if (messageId === null) return res.status(404).json({ error: 'message not found' });

  const { rows } = await db.query(
    `select m.id, m.draft, m.channel, m.review_json,
            c.name, c.company, c.role, c.relationship, c.met_at,
            coalesce(array_agg(n.body order by n.created_at desc)
                     filter (where n.body is not null), '{}') as notes
       from outreach_messages m
       join connections c on c.id = m.connection_id
       left join connection_notes n on n.connection_id = c.id
      where m.id = $1 and m.user_id = $2
      group by m.id, c.id`,
    [messageId, req.user.id],
  );
  const row = rows[0];
  if (!row) return res.status(404).json({ error: 'message not found' });

  if (row.review_json && !req.query.force) {
    return res.json({ review: row.review_json, cached: true });
  }

  try {
    const { result, usage } = await ai.complete(
      buildMessageReview({ draft: row.draft, channel: row.channel, connection: row }),
    );
    await db.query(
      'update outreach_messages set review_json = $1, reviewed_at = now() where id = $2',
      [result, messageId],
    );
    res.json({ review: result, usage, cached: false });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  }
});

router.post('/review-resume', aiLimit, validate(resumeReview), async (req, res, next) => {
  try {
    const { result, usage } = await ai.complete(
      buildResumeReview({ text: req.body.text, targetRole: req.body.target_role }),
    );
    res.json({ review: result, usage });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  }
});

module.exports = router;

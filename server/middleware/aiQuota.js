// The cumulative half of AI spend control. See middleware/rateLimit.js for the other
// half — they answer different questions and both are needed:
//   rateLimit  "how fast?"   in-process, resets on deploy, stops a runaway retry loop
//   aiQuota    "how much?"   in Postgres, survives everything, stops a determined user
const db = require('../db');

// ponytail: one number for everyone. Becomes a per-user column the day you want to
// raise it for someone without raising it for all of them.
const MONTHLY_CAP = Number(process.env.AI_MONTHLY_CAP ?? 40);

// Charges one call. Returns null when the user is under the cap, or a ready-to-send
// {status, body} when they aren't.
//
// Exported separately because one route only spends money on a cache MISS, and charging
// for a cached read would be charging for nothing. That route calls this itself, after
// it knows.
async function consume(userId) {
  // Increment and read in ONE statement. Select-then-update lets two concurrent requests
  // both read 39 and both proceed — the classic lost update, and the reason this is a
  // single atomic round trip rather than two more readable ones.
  //
  // The `case` is the reset: the first call of a new month overwrites the counter with 1
  // instead of adding to last month's total. No cron job, no sweep, no stale rows.
  const { rows } = await db.query(
    `update users
        set ai_calls  = case when ai_period = date_trunc('month', now())::date
                             then ai_calls + 1 else 1 end,
            ai_period = date_trunc('month', now())::date
      where id = $1
      returning ai_calls`,
    [userId],
  );
  if (!rows[0]) return { status: 401, body: { error: 'account no longer exists' } };
  if (rows[0].ai_calls <= MONTHLY_CAP) return null;

  // Say when it lifts. "Try again later" with no date is the most annoying possible way
  // to be rate limited.
  const resets = new Date();
  resets.setUTCMonth(resets.getUTCMonth() + 1, 1);
  const resets_on = resets.toISOString().slice(0, 10);
  return {
    status: 429,
    body: {
      error: `You've used all ${MONTHLY_CAP} AI reviews this month. Resets ${resets_on}.`,
      resets_on,
    },
  };
}

const aiQuota = async (req, res, next) => {
  const denied = await consume(req.user.id);
  if (denied) return res.status(denied.status).json(denied.body);
  next();
};

module.exports = aiQuota;
module.exports.consume = consume;
module.exports.MONTHLY_CAP = MONTHLY_CAP;

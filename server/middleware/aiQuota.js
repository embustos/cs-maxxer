// AI spend control, the cumulative half. See middleware/rateLimit.js for the other
// half — they answer different questions and both are needed:
//   rateLimit  "how fast?"   in-process, resets on deploy, stops a runaway retry loop
//   aiQuota    "how much?"   in Postgres, survives everything, stops a determined user
//
// Two pools, spent in order:
//   1. the free monthly allowance (ai_calls, resets when ai_period rolls over)
//   2. purchased credits (ai_credits, bought via routes/billing.js, never expire)
const db = require('../db');
const config = require('../config');

// ponytail: one free allowance for everyone. Becomes a per-user column the day you want
// to raise it for someone without raising it for all of them.
const MONTHLY_CAP = Number(process.env.AI_MONTHLY_CAP ?? 40);

// Charges one call. Returns null when allowed, or a ready-to-send {status, body}.
//
// One statement, with the old row read under FOR UPDATE. Two reasons it's shaped
// this way and not as a readable select-then-update:
//   * concurrency — two requests that both read "39 of 40" would both proceed; the row
//     lock serializes them so every increment lands.
//   * the outcome needs the OLD values. RETURNING only sees the new row, and
//     "credits: 0 after spending the last one" (allowed) is indistinguishable there
//     from "credits: 0 because there were none" (denied).
//
// The `case` on ai_period doubles as the monthly reset: the first call of a new month
// overwrites the counter instead of adding to it. No cron job, no sweep.
async function consume(userId) {
  const { rows } = await db.query(
    `with old as (
       select ai_calls, ai_period, ai_credits,
              ai_period = date_trunc('month', now())::date as same_month
         from users where id = $1 for update
     )
     update users u
        set ai_period  = date_trunc('month', now())::date,
            ai_calls   = case when not old.same_month then 1
                              when old.ai_calls < $2  then old.ai_calls + 1
                              else old.ai_calls end,
            ai_credits = case when old.same_month and old.ai_calls >= $2 and old.ai_credits > 0
                              then old.ai_credits - 1
                              else old.ai_credits end
       from old
      where u.id = $1
      returning (not old.same_month or old.ai_calls < $2 or old.ai_credits > 0) as allowed,
                u.ai_calls, u.ai_credits`,
    [userId, MONTHLY_CAP],
  );
  if (!rows[0]) return { status: 401, body: { error: 'account no longer exists' } };
  if (rows[0].allowed) return null;

  // Say when it lifts, and offer the way out when one exists. "Try again later" with
  // no date is the most annoying possible way to be rate limited.
  const resets = new Date();
  resets.setUTCMonth(resets.getUTCMonth() + 1, 1);
  const resets_on = resets.toISOString().slice(0, 10);
  const upgrade = Boolean(config.stripeSecretKey && config.stripePriceId);
  return {
    status: 429,
    body: {
      error: upgrade
        ? `You've used your ${MONTHLY_CAP} free reviews this month. Buy a pack of ${config.aiCreditsPerPurchase} to keep going, or wait for ${resets_on}.`
        : `You've used all ${MONTHLY_CAP} AI reviews this month. Resets ${resets_on}.`,
      resets_on,
      upgrade,
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

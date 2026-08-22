// Single-use, expiring, emailed tokens — for password reset and email verification.
//
// The raw token exists in exactly two places: the email we send, and the request the
// user comes back with. The database only ever sees its sha256, so a dump of
// email_tokens is useless to whoever gets it.
//
// sha256 and not bcrypt, deliberately: bcrypt is slow ON PURPOSE because passwords are
// low-entropy and guessable. A 256-bit random token is not guessable, so the slowness
// would buy nothing and cost a CPU-bound hash on every verification.
const crypto = require('crypto');
const db = require('./db');

const TTL_MINUTES = { reset: 60, verify: 60 * 24 * 7 };

const hash = (token) => crypto.createHash('sha256').update(token).digest('hex');

// Returns the RAW token — the only moment it is ever readable. Caller mails it.
async function issue(userId, purpose) {
  const token = crypto.randomBytes(32).toString('base64url');
  // Supersede any outstanding token of the same kind. Without this, every "I forgot my
  // password" click leaves another live key to the account lying in an old inbox.
  await db.query('delete from email_tokens where user_id = $1 and purpose = $2', [userId, purpose]);
  await db.query(
    `insert into email_tokens (token_hash, user_id, purpose, expires_at)
     values ($1, $2, $3, now() + ($4 || ' minutes')::interval)`,
    [hash(token), userId, purpose, String(TTL_MINUTES[purpose])],
  );
  return token;
}

// Marks the token used and returns its user id, or null. Single use is enforced by the
// UPDATE's own where-clause rather than a read followed by a write — two requests
// racing the same token both pass a read, but only one can win the update.
async function redeem(token, purpose) {
  if (typeof token !== 'string' || !token) return null;
  const { rows } = await db.query(
    `update email_tokens set used_at = now()
      where token_hash = $1 and purpose = $2 and used_at is null and expires_at > now()
      returning user_id`,
    [hash(token), purpose],
  );
  return rows[0]?.user_id ?? null;
}

module.exports = { issue, redeem, TTL_MINUTES };

const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const db = require('../db');
const config = require('../config');
const requireAuth = require('../middleware/auth');
const validate = require('../middleware/validate');
const tokens = require('../tokens');
const mail = require('../email');
const { log } = require('../middleware/logger');
const { credentials, registration, forgotPassword, resetPassword, emailToken } = require('../schemas');

const router = express.Router();

// ponytail: access token only, 7d. Add refresh tokens when you need instant
// revocation or want the access token down to 15min.
const sign = (user) =>
  jwt.sign({ sub: user.id, email: user.email }, config.jwtSecret, {
    expiresIn: '7d',
  });

// Compared against when the email doesn't exist, so login takes the same time
// either way and can't be used to enumerate accounts.
const DUMMY_HASH = bcrypt.hashSync('no-such-user', 12);

router.post('/register', validate(registration), async (req, res) => {
  const { email, password, username } = req.body; // validated, trimmed, lowercased
  const password_hash = await bcrypt.hash(password, 12);
  try {
    const { rows } = await db.query(
      `insert into users (email, password_hash, username) values ($1, $2, $3)
       returning id, email, username, github_username, daily_commit_goal, onboarded_at, reminder_cadence, email_verified_at`,
      [email, password_hash, username],
    );
    // Fire and forget. A Resend outage must not fail a registration that already
    // succeeded in the database — the account exists, and they can ask for the mail
    // again. Logged rather than swallowed so a broken sender is visible.
    sendVerification(rows[0]).catch((err) =>
      log({ level: 'error', msg: 'verification email failed', email: rows[0].email, err: err.message }),
    );
    res.status(201).json({ token: sign(rows[0]), user: rows[0] });
  } catch (err) {
    // Two unique constraints now, and telling the user the wrong one is worse than
    // useless — they'd go change the field that was actually fine.
    if (err.code === '23505') {
      const taken = err.constraint === 'users_username_lower_key' ? 'username' : 'email';
      return res.status(409).json({ error: `${taken} already taken` });
    }
    throw err; // express 5 forwards rejected promises to the error handler
  }
});

router.post('/login', validate(credentials), async (req, res) => {
  const { email, password } = req.body;
  const { rows } = await db.query(
    `select id, email, username, password_hash, github_username, daily_commit_goal,
            onboarded_at, reminder_cadence, email_verified_at
       from users where email = $1`,
    [email],
  );
  const user = rows[0];
  const ok = await bcrypt.compare(password, user?.password_hash ?? DUMMY_HASH);
  if (!user || !ok) return res.status(401).json({ error: 'invalid credentials' });

  // The hash must not leave the server, even to its owner.
  const { password_hash, ...safe } = user;
  res.json({ token: sign(user), user: safe });
});

// ---------------------------------------------------------------------------------
// Password reset and email verification.
//
// Both live under /api/auth, so both inherit that router's rate limit (index.js) — which
// matters most for /forgot, the one endpoint here that sends mail on an unauthenticated
// request.

async function sendVerification(user) {
  const token = await tokens.issue(user.id, 'verify');
  await mail.send({
    to: user.email,
    subject: 'Confirm your email for cs maxxer',
    text: `Confirm your email so cs maxxer can send you your digest:\n\n${mail.link('verify', token)}\n\nIf you didn't sign up, ignore this — the address won't be used.`,
  });
}

router.post('/forgot', validate(forgotPassword), async (req, res) => {
  const { rows } = await db.query('select id, email from users where email = $1', [req.body.email]);

  // ALWAYS 200, and always the same body. Returning 404 for an unknown address turns
  // this endpoint into a free "does this person have an account here?" oracle — which
  // is exactly what the constant-time compare in /login exists to prevent.
  if (rows[0]) {
    const token = await tokens.issue(rows[0].id, 'reset');
    try {
      await mail.send({
        to: rows[0].email,
        subject: 'Reset your cs maxxer password',
        text: `Someone asked to reset this account's password. The link works once and expires in an hour:\n\n${mail.link('reset', token)}\n\nIf that wasn't you, nothing has changed and you can ignore this.`,
      });
    } catch (err) {
      // Not surfaced: a send failure that changed the response would leak account
      // existence through the back door this endpoint was written to close.
      log({ level: 'error', msg: 'reset email failed', id: req.id, err: err.message });
    }
  }
  res.json({ ok: true });
});

router.post('/reset', validate(resetPassword), async (req, res) => {
  const userId = await tokens.redeem(req.body.token, 'reset');
  if (!userId) return res.status(400).json({ error: 'that link has expired or already been used' });

  const password_hash = await bcrypt.hash(req.body.password, 12);
  const { rows } = await db.query(
    `update users set password_hash = $1 where id = $2
     returning id, email, username, github_username, daily_commit_goal, onboarded_at, reminder_cadence, email_verified_at`,
    [password_hash, userId],
  );
  if (!rows[0]) return res.status(400).json({ error: 'that link has expired or already been used' });

  // Log them straight in. Making someone who just proved control of the inbox type the
  // password they set four seconds ago is friction with no security value.
  res.json({ token: sign(rows[0]), user: rows[0] });
});

router.post('/verify', validate(emailToken), async (req, res) => {
  const userId = await tokens.redeem(req.body.token, 'verify');
  if (!userId) return res.status(400).json({ error: 'that link has expired or already been used' });
  await db.query('update users set email_verified_at = now() where id = $1', [userId]);
  res.json({ ok: true });
});

// Re-send, for the common case of the first mail going to spam or being deleted.
router.post('/resend-verification', requireAuth, async (req, res) => {
  const { rows } = await db.query(
    'select id, email, email_verified_at from users where id = $1',
    [req.user.id],
  );
  if (!rows[0]) return res.status(401).json({ error: 'account no longer exists' });
  if (rows[0].email_verified_at) return res.json({ ok: true, already_verified: true });
  await sendVerification(rows[0]);
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------------

// Lets the client check "is my stored token still good?" on page load.
router.get('/me', requireAuth, async (req, res) => {
  const { rows } = await db.query('select id, email, username, github_username, daily_commit_goal, onboarded_at, reminder_cadence, email_verified_at from users where id = $1', [
    req.user.id,
  ]);
  // A signature that verifies is not enough — the account may have been deleted since the
  // token was issued. Falling back to the token's own claims here would keep a deleted
  // user logged in for the rest of the token's 7 days. This is the one place we do pay
  // for a DB lookup, and it's why it exists.
  if (!rows[0]) return res.status(401).json({ error: 'account no longer exists' });
  res.json({ user: rows[0] });
});

module.exports = router;

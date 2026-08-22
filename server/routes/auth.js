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

const USER_COLS = 'id, email, username, github_username, daily_commit_goal, onboarded_at, reminder_cadence, email_verified_at, ai_calls, ai_credits';

// Registration does NOT hand back a token. An account belongs to whoever reads the
// inbox, not whoever typed the address — so the session comes from clicking the
// emailed link (/verify below), which is the only proof of that. Until then the row
// exists but can't be used, which is what makes signing up as someone else's email
// pointless.
router.post('/register', validate(registration), async (req, res) => {
  const { email, password, username } = req.body; // validated, trimmed, lowercased
  const password_hash = await bcrypt.hash(password, 12);
  try {
    const { rows } = await db.query(
      `insert into users (email, password_hash, username) values ($1, $2, $3)
       returning ${USER_COLS}`,
      [email, password_hash, username],
    );
    // Awaited, not fire-and-forget: with login gated on verification, this mail IS the
    // signup. If it can't be sent the user must hear that now, not stare at an inbox
    // that will never receive anything.
    await sendVerification(rows[0]);
    res.status(201).json({ verify_sent: true, email: rows[0].email });
  } catch (err) {
    // Two unique constraints, and telling the user the wrong one is worse than
    // useless — they'd go change the field that was actually fine.
    if (err.code === '23505') {
      const taken = err.constraint === 'users_username_lower_key' ? 'username' : 'email';
      return res.status(409).json({ error: `${taken} already taken` });
    }
    throw err; // express 5 forwards rejected promises to the error handler
  }
});

// Three designated outcomes, each with a machine-readable code the client can act on.
//
// Yes, `no_account` discloses that an address has no account here. That was already
// public: /register answers "email already taken", so the oracle exists either way.
// What "invalid credentials" actually bought was users retyping a correct password
// under the wrong email — an error that tells you which field is wrong is one you can
// fix. The guessing cost is carried by this router's rate limit, not by vagueness.
router.post('/login', validate(credentials), async (req, res) => {
  const { email, password } = req.body;
  const { rows } = await db.query(
    `select ${USER_COLS}, password_hash from users where email = $1`,
    [email],
  );
  const user = rows[0];
  if (!user) {
    return res.status(401).json({ code: 'no_account', error: 'no account with that email' });
  }

  const ok = await bcrypt.compare(password, user.password_hash);
  if (!ok) return res.status(401).json({ code: 'bad_password', error: 'incorrect password' });

  // Checked AFTER the password on purpose: verification status is only revealed to
  // someone who already holds the credentials — effectively the owner.
  if (!user.email_verified_at) {
    // Re-send instead of just refusing. The one common way to land here is a signup
    // whose first mail went to spam or got deleted; a fresh link in the same breath
    // beats a dead end. tokens.issue supersedes the old link, and the router's rate
    // limit caps how often this can fire.
    sendVerification(user).catch((err) =>
      log({ level: 'error', msg: 'verification email failed', id: req.id, err: err.message }),
    );
    return res.status(403).json({
      code: 'unverified',
      error: 'confirm your email first — we just sent you a fresh link',
    });
  }

  // The hash must not leave the server, even to its owner.
  const { password_hash, ...safe } = user;
  res.json({ token: sign(user), user: safe });
});

// ---------------------------------------------------------------------------------
// Password reset and email verification.
//
// Both live under /api/auth, so both inherit that router's rate limit (index.js) — which
// matters most for /forgot and the unverified-login resend, the endpoints that send mail
// on an unauthenticated request.

async function sendVerification(user) {
  const token = await tokens.issue(user.id, 'verify');
  await mail.send({
    to: user.email,
    subject: 'Confirm your email for cs maxxer',
    text: `Click to confirm your email and you'll be signed straight in:\n\n${mail.link('verify', token)}\n\nIf you didn't sign up, ignore this — the account can't be used without it.`,
  });
}

router.post('/forgot', validate(forgotPassword), async (req, res) => {
  const { rows } = await db.query('select id, email from users where email = $1', [req.body.email]);

  // ALWAYS 200, and always the same body. Login and register disclose account
  // existence by design, so this opacity is not load-bearing anymore — but there is
  // also nothing useful for the response to say, and "we emailed you IF you exist"
  // costs nothing to keep symmetric.
  if (rows[0]) {
    const token = await tokens.issue(rows[0].id, 'reset');
    try {
      await mail.send({
        to: rows[0].email,
        subject: 'Reset your cs maxxer password',
        text: `Someone asked to reset this account's password. The link works once and expires in an hour:\n\n${mail.link('reset', token)}\n\nIf that wasn't you, nothing has changed and you can ignore this.`,
      });
    } catch (err) {
      log({ level: 'error', msg: 'reset email failed', id: req.id, err: err.message });
    }
  }
  res.json({ ok: true });
});

router.post('/reset', validate(resetPassword), async (req, res) => {
  const userId = await tokens.redeem(req.body.token, 'reset');
  if (!userId) return res.status(400).json({ error: 'that link has expired or already been used' });

  const password_hash = await bcrypt.hash(req.body.password, 12);
  // Completing a reset also proves control of the inbox — it arrived by email — so it
  // verifies the address as a side effect. Without this, an unverified user who resets
  // their password would immediately bounce off the login gate they just satisfied.
  const { rows } = await db.query(
    `update users set password_hash = $1, email_verified_at = coalesce(email_verified_at, now())
      where id = $2 returning ${USER_COLS}`,
    [password_hash, userId],
  );
  if (!rows[0]) return res.status(400).json({ error: 'that link has expired or already been used' });

  // Log them straight in. Making someone who just proved control of the inbox type the
  // password they set four seconds ago is friction with no security value.
  res.json({ token: sign(rows[0]), user: rows[0] });
});

// Verifying signs you in, same reasoning as /reset: the link came from the inbox, and
// clicking it is the strongest proof of ownership this app ever gets. With registration
// no longer issuing tokens, this is also where a new account's first session starts.
router.post('/verify', validate(emailToken), async (req, res) => {
  const userId = await tokens.redeem(req.body.token, 'verify');
  if (!userId) return res.status(400).json({ error: 'that link has expired or already been used' });
  const { rows } = await db.query(
    `update users set email_verified_at = coalesce(email_verified_at, now())
      where id = $1 returning ${USER_COLS}`,
    [userId],
  );
  if (!rows[0]) return res.status(400).json({ error: 'that link has expired or already been used' });
  res.json({ token: sign(rows[0]), user: rows[0] });
});

// ---------------------------------------------------------------------------------

// Lets the client check "is my stored token still good?" on page load.
router.get('/me', requireAuth, async (req, res) => {
  const { rows } = await db.query(`select ${USER_COLS} from users where id = $1`, [
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

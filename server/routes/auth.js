const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const db = require('../db');
const config = require('../config');
const requireAuth = require('../middleware/auth');
const validate = require('../middleware/validate');
const { credentials, registration } = require('../schemas');

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
      'insert into users (email, password_hash, username) values ($1, $2, $3) returning id, email',
      [email, password_hash, username],
    );
    res.status(201).json({ token: sign(rows[0]) });
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
    'select id, email, password_hash from users where email = $1',
    [email],
  );
  const user = rows[0];
  const ok = await bcrypt.compare(password, user?.password_hash ?? DUMMY_HASH);
  if (!user || !ok) return res.status(401).json({ error: 'invalid credentials' });

  res.json({ token: sign(user) });
});

// Lets the client check "is my stored token still good?" on page load.
router.get('/me', requireAuth, async (req, res) => {
  const { rows } = await db.query('select id, email, username, github_username, daily_commit_goal, onboarded_at, reminder_cadence from users where id = $1', [
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

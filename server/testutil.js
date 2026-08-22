// Shared by every *.test.js that needs an account.
//
// Registration no longer returns a token — a session comes from clicking the emailed
// verification link, which tests don't have an inbox for. So this registers over HTTP
// (exercising the real route and its validation) and then mints the JWT directly with
// the same secret the server verifies against. Minting locally also spares the
// 10-capacity auth rate limit that a login per test account would drain.
const jwt = require('jsonwebtoken');
const config = require('./config');
const db = require('./db');

const uname = () => `u${Math.random().toString(36).slice(2, 10)}`;

async function register(base, email) {
  const res = await fetch(`${base}/api/auth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: 'password123', username: uname() }),
  });
  if (res.status !== 201) throw new Error(`register failed: ${res.status} ${await res.text()}`);
  const { rows } = await db.query('select id, email, username from users where email = $1', [email]);
  const user = rows[0];
  return { token: jwt.sign({ sub: user.id, email: user.email }, config.jwtSecret, { expiresIn: '1h' }), user };
}

module.exports = { register, uname };

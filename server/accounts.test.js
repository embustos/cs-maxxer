// Password reset, email verification, and the AI spend cap.
//
// These go through tokens.js and aiQuota.js directly rather than over HTTP, for the same
// reason the username-format tests do: /api/auth is rate limited to 10 attempts, and a
// test file that spends them all fails with a 429 that has nothing to do with what it
// was checking.
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const db = require('./db');
const tokens = require('./tokens');
const aiQuota = require('./middleware/aiQuota');

const uid = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
const email = `acct-${uid()}@example.com`;
let userId;

before(async () => {
  const { rows } = await db.query(
    "insert into users (email, password_hash, username) values ($1, 'x', $2) returning id",
    [email, `t${Math.random().toString(36).slice(2, 10)}`],
  );
  userId = rows[0].id;
});

after(async () => {
  await db.query('delete from users where id = $1', [userId]);
  await db.end();
});

test('a reset token works exactly once', async () => {
  const token = await tokens.issue(userId, 'reset');
  assert.strictEqual(await tokens.redeem(token, 'reset'), userId);
  // The whole point of the used_at column. Without it a link sitting in an old inbox is
  // a permanent key to the account.
  assert.strictEqual(await tokens.redeem(token, 'reset'), null);
});

test('the raw token is never stored', async () => {
  const token = await tokens.issue(userId, 'reset');
  const { rows } = await db.query('select token_hash from email_tokens where user_id = $1', [userId]);
  assert.strictEqual(rows.length, 1);
  assert.notStrictEqual(rows[0].token_hash, token);
  // A leak of this table must not be usable against the app that produced it.
  assert.strictEqual(await tokens.redeem(rows[0].token_hash, 'reset'), null);
});

test('issuing a new token invalidates the old one', async () => {
  const first = await tokens.issue(userId, 'reset');
  const second = await tokens.issue(userId, 'reset');
  assert.strictEqual(await tokens.redeem(first, 'reset'), null);
  assert.strictEqual(await tokens.redeem(second, 'reset'), userId);
});

test('an expired token is rejected', async () => {
  const token = await tokens.issue(userId, 'reset');
  await db.query("update email_tokens set expires_at = now() - interval '1 second' where user_id = $1", [userId]);
  assert.strictEqual(await tokens.redeem(token, 'reset'), null);
});

test('a verify token cannot be spent as a reset token', async () => {
  const token = await tokens.issue(userId, 'verify');
  // Purposes share a table; they must not share authority. A confirm-your-email link
  // that also resets the password would make every old signup email a takeover.
  assert.strictEqual(await tokens.redeem(token, 'reset'), null);
  assert.strictEqual(await tokens.redeem(token, 'verify'), userId);
});

test('a garbage token is rejected without throwing', async () => {
  for (const bad of ['', 'nonsense', null, undefined, 12345]) {
    assert.strictEqual(await tokens.redeem(bad, 'reset'), null);
  }
});

test('the AI quota counts up and then refuses', async () => {
  const cap = aiQuota.MONTHLY_CAP;
  await db.query('update users set ai_calls = $1 where id = $2', [cap - 1, userId]);

  assert.strictEqual(await aiQuota.consume(userId), null, 'the last call under the cap is allowed');

  const denied = await aiQuota.consume(userId);
  assert.strictEqual(denied.status, 429);
  assert.match(denied.body.error, /this month/);
  assert.match(denied.body.resets_on, /^\d{4}-\d{2}-\d{2}$/);
});

test('the AI quota resets when the month rolls over', async () => {
  // The exact thing the in-process rate limiter cannot do: a count that persists across
  // restarts still has to forget last month.
  await db.query(
    `update users set ai_calls = $1, ai_period = date_trunc('month', now() - interval '1 month')::date
      where id = $2`,
    [aiQuota.MONTHLY_CAP + 100, userId],
  );
  assert.strictEqual(await aiQuota.consume(userId), null);
  const { rows } = await db.query('select ai_calls from users where id = $1', [userId]);
  assert.strictEqual(rows[0].ai_calls, 1, 'the counter restarts rather than accumulating');
});

test('the AI quota survives concurrent requests', async () => {
  // Select-then-update would let both of these read the same value and both proceed.
  await db.query('update users set ai_calls = 0 where id = $1', [userId]);
  await Promise.all(Array.from({ length: 10 }, () => aiQuota.consume(userId)));
  const { rows } = await db.query('select ai_calls from users where id = $1', [userId]);
  assert.strictEqual(rows[0].ai_calls, 10, 'no increments were lost');
});

// --- /auth/forgot over HTTP -------------------------------------------------------
// This one has to be an HTTP test: the property under test is the shape of the RESPONSE,
// which is the part an attacker sees.
const app = require('./index');
const mail = require('./email');

test('/auth/forgot cannot be used to discover who has an account', async () => {
  const server = app.listen(0);
  const base = `http://localhost:${server.address().port}`;
  const post = (body) =>
    fetch(`${base}/api/auth/forgot`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });

  try {
    mail.sent.length = 0;
    const real = await post({ email });
    const fake = await post({ email: `nobody-${uid()}@example.com` });

    // Identical status AND identical body. A 404, a different error string, or an extra
    // field would each turn this endpoint into a "does this person have an account?"
    // oracle — the exact thing the dummy-hash compare in /login exists to prevent.
    assert.strictEqual(real.status, 200);
    assert.strictEqual(fake.status, 200);
    assert.deepStrictEqual(await real.json(), await fake.json());

    // ...and only the real address was actually mailed.
    assert.deepStrictEqual(mail.sent.map((m) => m.to), [email]);
    assert.match(mail.sent[0].text, /\?reset=/);
  } finally {
    server.close();
  }
});

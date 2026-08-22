const { test, before, after } = require('node:test');
const assert = require('node:assert');

// Usernames are unique too, so tests need a fresh one per account.
const uname = () => `u${Math.random().toString(36).slice(2, 10)}`;
const uid = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
const app = require('./index');
const db = require('./db');

const email = `onb-${uid()}@example.com`;
const skipper = `onb-skip-${uid()}@example.com`;
const roller = `onb-roll-${uid()}@example.com`;
let base, server, token, skipToken, rollToken;

const req = (method, path, { body, auth = token } = {}) =>
  fetch(base + path, {
    method,
    headers: { 'content-type': 'application/json', ...(auth && { authorization: `Bearer ${auth}` }) },
    ...(body && !['GET', 'HEAD'].includes(method) && { body: JSON.stringify(body) }),
  });

const { register: sharedRegister } = require('./testutil');
const ghName = `ghx${Math.random().toString(36).slice(2, 10)}`;
const register = (e) => sharedRegister(base, e);

const countFor = async (table, e) => {
  const { rows } = await db.query(
    `select count(*)::int as n from ${table} t join users u on u.id = t.user_id where u.email = $1`,
    [e],
  );
  return rows[0].n;
};

before(async () => {
  server = app.listen(0);
  base = `http://localhost:${server.address().port}`;
  ({ token } = await register(email));
  ({ token: skipToken } = await register(skipper));
  ({ token: rollToken } = await register(roller));
});

after(async () => {
  await db.query('delete from users where email = any($1)', [[email, skipper, roller]]);
  server.close();
  await db.end();
});

test('a fresh account reports not-onboarded', async () => {
  const { onboarded } = await (await req('GET', '/api/onboarding')).json();
  assert.strictEqual(onboarded, false);
});

test('the survey creates real habits and goals', async () => {
  const res = await req('POST', '/api/onboarding', {
    body: {
      habits: ['LeetCode daily', 'Commit to a side project'],
      goals: [{ title: '100 LeetCode problems', target: 100, due_on: '2027-05-01' }],
      reminder_cadence: 'daily',
      // random: a fixed name would collide with the unique index (migration 016) the
      // moment any real account in the dev database owns it
      github_username: ghName,
    },
  });
  assert.strictEqual(res.status, 201);

  assert.strictEqual(await countFor('habits', email), 2);
  assert.strictEqual(await countFor('goals', email), 1);

  const { rows } = await db.query(
    'select onboarded_at, reminder_cadence, github_username from users where email = $1',
    [email],
  );
  assert.ok(rows[0].onboarded_at);
  assert.strictEqual(rows[0].reminder_cadence, 'daily');
  assert.strictEqual(rows[0].github_username, ghName);
});

test('submitting twice does not double-create', async () => {
  // A double-click or a retried request must not seed a second set of habits.
  const res = await req('POST', '/api/onboarding', { body: { habits: ['Duplicate'], goals: [] } });
  assert.strictEqual(res.status, 409);
  assert.strictEqual(await countFor('habits', email), 2, 'still two');
});

test('a mid-transaction failure rolls back every insert', async () => {
  // Validation catches bad input before the transaction opens, and the zod schemas
  // deliberately agree with the DB constraints — so to exercise the rollback we need a
  // failure the schema can't see. Deleting the user after the token is issued makes the
  // habit insert violate its foreign key partway through the transaction.
  await db.query('delete from users where email = $1', [roller]);

  const res = await req('POST', '/api/onboarding', {
    body: {
      habits: ['Should not survive', 'Nor should this'],
      goals: [{ title: 'Never created', target: 10 }],
    },
    auth: rollToken,
  });
  assert.strictEqual(res.status, 500, 'the failure surfaces rather than half-succeeding');

  // The real assertion: nothing was left behind by the inserts that ran before the
  // failure. Without the transaction, the first habit would still be sitting there.
  const { rows } = await db.query(
    "select count(*)::int as n from habits where title in ('Should not survive', 'Nor should this')",
  );
  assert.strictEqual(rows[0].n, 0, 'partial inserts must be rolled back');
});

test('skipping marks you onboarded without creating anything', async () => {
  assert.strictEqual((await req('POST', '/api/onboarding/skip', { auth: skipToken })).status, 204);

  const { rows } = await db.query('select onboarded_at, reminder_cadence from users where email = $1', [skipper]);
  assert.ok(rows[0].onboarded_at, 'so we never ask again');
  assert.strictEqual(rows[0].reminder_cadence, 'weekly', 'gets a sane default');
  assert.strictEqual(await countFor('habits', skipper), 0);
});

test('rejects oversized or malformed surveys', async () => {
  const { token: fresh } = await register(`onb-bad-${uid()}@example.com`);
  for (const body of [
    { habits: Array.from({ length: 20 }, (_, i) => `h${i}`) },   // over the cap
    { goals: [{ title: 'x', target: 0 }] },                       // target below 1
    { goals: [{ title: '', target: 5 }] },                        // empty title
    { reminder_cadence: 'hourly' },                               // not a real cadence
    { github_username: '../../etc/passwd' },                      // not a username
  ]) {
    const res = await req('POST', '/api/onboarding', { body, auth: fresh });
    assert.strictEqual(res.status, 400, `should reject ${JSON.stringify(body).slice(0, 60)}`);
  }
  await db.query("delete from users where email like 'onb-bad-%@example.com'");
});

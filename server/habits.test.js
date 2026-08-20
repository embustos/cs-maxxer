// Needs the database running: docker compose up -d
// Gets proper isolation and a dedicated test DB at concept 13.
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const app = require('./index');
const db = require('./db');

const email = `test-${Date.now()}@example.com`;
let base, server, token, habitId;

const req = (method, path, { body, auth = token } = {}) =>
  fetch(base + path, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(auth && { authorization: `Bearer ${auth}` }),
    },
    // fetch throws if a GET/HEAD carries a body, so drop it regardless of the caller
    ...(body && !['GET', 'HEAD'].includes(method) && { body: JSON.stringify(body) }),
  });

before(async () => {
  server = app.listen(0);
  base = `http://localhost:${server.address().port}`;
  const res = await req('POST', '/api/auth/register', {
    body: { email, password: 'password123' },
    auth: null,
  });
  ({ token } = await res.json());
});

after(async () => {
  await db.query('delete from users where email = $1', [email]); // cascades to habits
  server.close();
  await db.end();
});

test('POST creates a habit and returns 201 + Location', async () => {
  const res = await req('POST', '/api/habits', { body: { title: 'LeetCode daily' } });
  assert.strictEqual(res.status, 201);
  assert.match(res.headers.get('location'), /^\/api\/habits\/\d+$/);
  ({ habit: { id: habitId } } = await res.json());
});

test('rejects bad input with 400', async () => {
  for (const body of [
    { title: '   ' },
    { title: 'x', cadence: 'hourly' },
    { title: 'x', target_per_week: 9 },
    { title: 'x', target_per_week: 1.5 },
  ]) {
    const res = await req('POST', '/api/habits', { body });
    assert.strictEqual(res.status, 400, `should reject ${JSON.stringify(body)}`);
  }
});

test('GET lists the habit, not yet done today', async () => {
  const { habits } = await (await req('GET', '/api/habits')).json();
  const habit = habits.find((h) => h.id === habitId);
  assert.ok(habit);
  assert.strictEqual(habit.done_today, false);
});

test('PUT completion is idempotent — twice still means one row', async () => {
  const url = `/api/habits/${habitId}/completions/2026-08-16`;
  assert.strictEqual((await req('PUT', url)).status, 204);
  assert.strictEqual((await req('PUT', url)).status, 204);

  const { rows } = await db.query('select count(*)::int as n from habit_completions where habit_id = $1', [habitId]);
  assert.strictEqual(rows[0].n, 1);

  assert.strictEqual((await req('DELETE', url)).status, 204);
  assert.strictEqual((await req('DELETE', url)).status, 204); // undoing twice is fine too
});

test('a garbage id is 404, not a 500', async () => {
  const res = await req('PATCH', '/api/habits/abc', { body: { title: 'x' } });
  assert.strictEqual(res.status, 404);
});

test('no token means 401 on every habits route', async () => {
  for (const [method, path] of [
    ['GET', '/api/habits'],
    ['POST', '/api/habits'],
    ['PATCH', `/api/habits/${habitId}`],
    ['DELETE', `/api/habits/${habitId}`],
  ]) {
    const res = await req(method, path, { auth: null, body: { title: 'x' } });
    assert.strictEqual(res.status, 401, `${method} ${path} should be 401`);
  }
});

test("another user cannot see or touch this user's habits", async () => {
  const other = `other-${Date.now()}@example.com`;
  const { token: evil } = await (
    await req('POST', '/api/auth/register', { body: { email: other, password: 'password123' }, auth: null })
  ).json();

  const { habits } = await (await req('GET', '/api/habits', { auth: evil })).json();
  assert.deepStrictEqual(habits, [], 'should see none of our habits');

  // 404 rather than 403 — a 403 would confirm the habit exists
  assert.strictEqual((await req('PATCH', `/api/habits/${habitId}`, { body: { title: 'HACKED' }, auth: evil })).status, 404);
  assert.strictEqual((await req('DELETE', `/api/habits/${habitId}`, { auth: evil })).status, 404);

  const { rows } = await db.query('select title from habits where id = $1', [habitId]);
  assert.strictEqual(rows[0].title, 'LeetCode daily', 'title must be untouched');

  await db.query('delete from users where email = $1', [other]);
});

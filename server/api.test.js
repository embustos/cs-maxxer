// Integration tests: real Express, real Postgres. Needs `docker compose up -d`.
// These are the tests that would have caught every bug found while building this.
const { test, before, after } = require('node:test');
const assert = require('node:assert');

const uid = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
const app = require('./index');
const db = require('./db');

const email = `api-${uid()}@example.com`;
const other = `api-other-${uid()}@example.com`;
let base, server, token, otherToken;

const req = (method, path, { body, auth = token } = {}) =>
  fetch(base + path, {
    method,
    headers: { 'content-type': 'application/json', ...(auth && { authorization: `Bearer ${auth}` }) },
    ...(body && !['GET', 'HEAD'].includes(method) && { body: JSON.stringify(body) }),
  });

const register = async (e) =>
  (await req('POST', '/api/auth/register', { body: { email: e, password: 'password123' }, auth: null })).json();

before(async () => {
  server = app.listen(0);
  base = `http://localhost:${server.address().port}`;
  ({ token } = await register(email));
  ({ token: otherToken } = await register(other));
});

after(async () => {
  await db.query('delete from users where email = any($1)', [[email, other]]);
  server.close();
  await db.end();
});

test('applications: create, list, patch stage, delete', async () => {
  const created = await req('POST', '/api/applications', { body: { company: 'Stripe', role: 'SWE Intern' } });
  assert.strictEqual(created.status, 201);
  const { application } = await created.json();
  assert.strictEqual(application.stage, 'applied'); // default applied

  const patched = await req('PATCH', `/api/applications/${application.id}`, { body: { stage: 'interview' } });
  assert.strictEqual(patched.status, 200);
  assert.strictEqual((await patched.json()).application.stage, 'interview');

  // the company must NOT have been wiped by the partial update
  const { applications } = await (await req('GET', '/api/applications')).json();
  assert.strictEqual(applications[0].company, 'Stripe');

  assert.strictEqual((await req('DELETE', `/api/applications/${application.id}`)).status, 204);
});

test('events and goals validate their inputs', async () => {
  assert.strictEqual((await req('POST', '/api/events', { body: { title: 'x', starts_at: 'tomorrow' } })).status, 400);
  assert.strictEqual((await req('POST', '/api/goals', { body: { title: 'x', target: 0 } })).status, 400);
  assert.strictEqual((await req('POST', '/api/goals', { body: { title: '', target: 5 } })).status, 400);

  const ok = await req('POST', '/api/events', {
    body: { title: 'Career fair', kind: 'career_fair', starts_at: '2026-09-01T18:00:00Z' },
  });
  assert.strictEqual(ok.status, 201);
});

test('streaks count consecutive days and break on a gap', async () => {
  const { habit } = await (await req('POST', '/api/habits', { body: { title: 'streak test' } })).json();
  const day = (n) => new Date(Date.now() - n * 86400000).toLocaleDateString('en-CA');

  for (const n of [0, 1, 2]) {
    assert.strictEqual((await req('PUT', `/api/habits/${habit.id}/completions/${day(n)}`)).status, 204);
  }
  let { habits } = await (await req('GET', `/api/habits?today=${day(0)}`)).json();
  assert.strictEqual(habits.find((h) => h.id === habit.id).streak, 3);

  // a completion 5 days ago does not extend a run that already broke
  await req('PUT', `/api/habits/${habit.id}/completions/${day(5)}`);
  ({ habits } = await (await req('GET', `/api/habits?today=${day(0)}`)).json());
  assert.strictEqual(habits.find((h) => h.id === habit.id).streak, 3, 'gap must not join the runs');

  // and the streak survives an unfinished today (run ending yesterday still counts)
  await req('DELETE', `/api/habits/${habit.id}/completions/${day(0)}`);
  ({ habits } = await (await req('GET', `/api/habits?today=${day(0)}`)).json());
  assert.strictEqual(habits.find((h) => h.id === habit.id).streak, 2);
});

test('SQL injection attempts are stored as literal text, not executed', async () => {
  const payload = "Robert'); drop table habits;--";
  const { habit } = await (await req('POST', '/api/habits', { body: { title: payload } })).json();

  // If the value had been interpolated into SQL, the table would be gone by now.
  const { habits } = await (await req('GET', '/api/habits')).json();
  assert.ok(habits.some((h) => h.title === payload), 'stored verbatim');

  const still = await db.query('select count(*)::int as n from habits');
  assert.ok(still.rows[0].n > 0, 'habits table still exists');
  await req('DELETE', `/api/habits/${habit.id}`);
});

test('every resource is isolated per user', async () => {
  const { application } = await (
    await req('POST', '/api/applications', { body: { company: 'Secret Co', role: 'x' } })
  ).json();
  const { goal } = await (await req('POST', '/api/goals', { body: { title: 'mine', target: 10 } })).json();

  // Each resource gets a field that actually exists on it — an unknown field is
  // stripped by zod and answers 400 "nothing to update" before ownership is ever checked.
  for (const [path, id, patch] of [
    ['applications', application.id, { company: 'HACKED' }],
    ['goals', goal.id, { title: 'HACKED' }],
  ]) {
    const list = await (await req('GET', `/api/${path}`, { auth: otherToken })).json();
    assert.strictEqual(list[path].length, 0, `${path} must not leak`);
    assert.strictEqual(
      (await req('PATCH', `/api/${path}/${id}`, { body: patch, auth: otherToken })).status,
      404,
      '404 not 403 — never confirm it exists',
    );
    assert.strictEqual((await req('DELETE', `/api/${path}/${id}`, { auth: otherToken })).status, 404);
  }

  const check = await db.query('select company from applications where id = $1', [application.id]);
  assert.strictEqual(check.rows[0].company, 'Secret Co', 'untouched');
});

test('a token for a deleted account stops working', async () => {
  // The signature still verifies — jwt.verify has no idea the row is gone. Without an
  // explicit existence check, deleting an account would leave it logged in for 7 more days.
  const doomed = `api-doomed-${uid()}@example.com`;
  const { token: doomedToken } = await register(doomed);
  assert.strictEqual((await req('GET', '/api/auth/me', { auth: doomedToken })).status, 200);

  await db.query('delete from users where email = $1', [doomed]);
  assert.strictEqual((await req('GET', '/api/auth/me', { auth: doomedToken })).status, 401);
});

test('unknown routes 404 and every resource requires a token', async () => {
  assert.strictEqual((await req('GET', '/api/nonsense')).status, 404);
  for (const p of ['/api/habits', '/api/applications', '/api/events', '/api/goals', '/api/github/activity']) {
    assert.strictEqual((await req('GET', p, { auth: null })).status, 401, `${p} must require auth`);
  }
});

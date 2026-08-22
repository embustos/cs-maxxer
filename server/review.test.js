const { test, before, after } = require('node:test');
const assert = require('node:assert');

// Usernames are unique too, so tests need a fresh one per account.
const uname = () => `u${Math.random().toString(36).slice(2, 10)}`;
const uid = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
const app = require('./index');
const db = require('./db');

const email = `rev-${uid()}@example.com`;
const other = `rev-other-${uid()}@example.com`;
let base, server, token, otherToken, userId, answerId;

const req = (method, path, { body, auth = token } = {}) =>
  fetch(base + path, {
    method,
    headers: { 'content-type': 'application/json', ...(auth && { authorization: `Bearer ${auth}` }) },
    ...(body && !['GET', 'HEAD'].includes(method) && { body: JSON.stringify(body) }),
  });

const { register: sharedRegister } = require('./testutil');
const register = (e) => sharedRegister(base, e);

const day = (n) => new Date(Date.now() - n * 86400000).toLocaleDateString('en-CA');

before(async () => {
  server = app.listen(0);
  base = `http://localhost:${server.address().port}`;
  ({ token } = await register(email));
  ({ token: otherToken } = await register(other));
  ({ rows: [{ id: userId }] } = await db.query('select id from users where email = $1', [email]));
});

after(async () => {
  await db.query('delete from users where email = any($1)', [[email, other]]);
  server.close();
  await db.end();
});

// ---- interview answers ----

test('saves a partial STAR answer and reports what is missing', async () => {
  // A half-written answer is worth keeping — the UI shows which parts are blank rather
  // than refusing to save.
  const res = await req('POST', '/api/interview-answers', {
    body: { question: 'Tell me about a time you failed.', situation: 'Shipped a bad migration.' },
  });
  assert.strictEqual(res.status, 201);
  const { interview_answer: a } = await res.json();
  answerId = a.id;
  assert.strictEqual(a.situation, 'Shipped a bad migration.');
  assert.strictEqual(a.task, null);
});

test('editing an answer bumps updated_at via the DB trigger', async () => {
  // The generic CRUD route never sets updated_at — a trigger does, so no future caller
  // can forget it. Ordering by recency depends on this.
  const { rows: before } = await db.query('select created_at, updated_at from interview_answers where id = $1', [answerId]);
  assert.deepStrictEqual(before[0].created_at, before[0].updated_at, 'equal on insert');

  await new Promise((r) => setTimeout(r, 1100)); // now() is transaction-scoped
  await req('PATCH', `/api/interview-answers/${answerId}`, { body: { result: 'Added a rollback test.' } });

  const { rows: after } = await db.query('select created_at, updated_at from interview_answers where id = $1', [answerId]);
  assert.ok(after[0].updated_at > after[0].created_at, 'trigger must bump updated_at');
});

test('rejects malformed answers', async () => {
  for (const body of [{ question: '   ' }, { question: 'x'.repeat(600) }, {}]) {
    assert.strictEqual((await req('POST', '/api/interview-answers', { body })).status, 400);
  }
});

// ---- weekly review ----

test('weekly review counts this week and compares to last', async () => {
  const habit = await (await req('POST', '/api/habits', { body: { title: 'review probe' } })).json();
  // two completions inside this week, one inside last week
  for (const n of [0, 2, 9]) {
    await req('PUT', `/api/habits/${habit.habit.id}/completions/${day(n)}`);
  }
  await req('POST', '/api/applications', { body: { company: 'Acme', role: 'SWE', applied_on: day(1) } });

  const { metrics } = await (await req('GET', `/api/review/weekly?today=${day(0)}`)).json();
  const by = Object.fromEntries(metrics.map((m) => [m.label, m]));

  assert.strictEqual(by['Habits completed'].value, 2, 'only this week');
  assert.strictEqual(by['Habits completed'].previous, 1, 'the one from last week');
  assert.strictEqual(by['Habits completed'].delta, 1);
  assert.strictEqual(by['Applications sent'].value, 1);
});

test('weekly review uses the date it is given, not the server clock', async () => {
  // Same reasoning as done_today: the DB runs UTC and would disagree with the browser
  // about which week it is for part of every day.
  const { week_end } = await (await req('GET', '/api/review/weekly?today=2026-01-15')).json();
  assert.match(new Date(week_end).toISOString(), /^2026-01-15/);
  assert.strictEqual((await req('GET', '/api/review/weekly?today=nope')).status, 400);
});

test('the weekly review only ever counts your own rows', async () => {
  const { metrics } = await (await req('GET', `/api/review/weekly?today=${day(0)}`, { auth: otherToken })).json();
  for (const m of metrics) {
    assert.strictEqual(m.value, 0, `${m.label} must be zero for a different user`);
    assert.strictEqual(m.previous, 0);
  }
});

test('another user cannot see or touch interview answers', async () => {
  const { interview_answers } = await (await req('GET', '/api/interview-answers', { auth: otherToken })).json();
  assert.deepStrictEqual(interview_answers, []);

  assert.strictEqual((await req('PATCH', `/api/interview-answers/${answerId}`, { body: { question: 'HACKED' }, auth: otherToken })).status, 404);
  assert.strictEqual((await req('DELETE', `/api/interview-answers/${answerId}`, { auth: otherToken })).status, 404);

  const { rows } = await db.query('select question from interview_answers where id = $1', [answerId]);
  assert.match(rows[0].question, /time you failed/, 'untouched');
});

test('both new routes require a token', async () => {
  for (const p of ['/api/interview-answers', '/api/review/weekly']) {
    assert.strictEqual((await req('GET', p, { auth: null })).status, 401);
  }
});

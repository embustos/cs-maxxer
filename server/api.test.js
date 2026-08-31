// Integration tests: real Express, real Postgres. Needs `docker compose up -d`.
// These are the tests that would have caught every bug found while building this.
const { test, before, after } = require('node:test');
const assert = require('node:assert');

// Usernames are unique too, so tests need a fresh one per account.
const today = () => new Date().toLocaleDateString('en-CA');
const uname = () => `u${Math.random().toString(36).slice(2, 10)}`;
const uid = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
const app = require('./index');
const db = require('./db');
const testutil = require('./testutil');
const { registration } = require('./schemas');

const email = `api-${uid()}@example.com`;
const other = `api-other-${uid()}@example.com`;
let base, server, token, otherToken;

const req = (method, path, { body, auth = token } = {}) =>
  fetch(base + path, {
    method,
    headers: { 'content-type': 'application/json', ...(auth && { authorization: `Bearer ${auth}` }) },
    ...(body && !['GET', 'HEAD'].includes(method) && { body: JSON.stringify(body) }),
  });

const register = (e) => testutil.register(base, e);

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

test('an application carries its detail fields and a partial update keeps the rest', async () => {
  const { application } = await (
    await req('POST', '/api/applications', { body: { company: 'Ramp', role: 'SWE Intern' } })
  ).json();

  const details = {
    company_size: '~1000',
    location: 'New York, NY · Hybrid',
    source: 'Referral from a classmate',
    requirements: 'TypeScript, Postgres, graduating 2027',
    recruiter: 'Dana — dana@example.com, replied Aug 20',
    contacts: 'Sam (backend eng, met at the career fair)',
    documents: 'resume-v3.pdf, cover letter',
    notes: 'Ask about the intern-to-return rate.',
  };
  const saved = (await (await req('PATCH', `/api/applications/${application.id}`, { body: details })).json())
    .application;
  for (const [k, v] of Object.entries(details)) assert.strictEqual(saved[k], v, k);

  // The panel sends every field on save, including cleared ones — a null must land as
  // null and must NOT drag the untouched fields down with it.
  const cleared = (await (
    await req('PATCH', `/api/applications/${application.id}`, { body: { recruiter: null } })
  ).json()).application;
  assert.strictEqual(cleared.recruiter, null);
  assert.strictEqual(cleared.location, 'New York, NY · Hybrid');

  // Still a trust boundary: the caps are the reason a text column can't become a novel.
  const tooLong = await req('PATCH', `/api/applications/${application.id}`, {
    body: { company_size: 'x'.repeat(61) },
  });
  assert.strictEqual(tooLong.status, 400);

  // The list route selects the same columns as the write route — a field that saves but
  // doesn't come back is invisible to the panel that has to render it.
  const { applications } = await (await req('GET', '/api/applications')).json();
  assert.strictEqual(applications.find((a) => a.id === application.id).documents, 'resume-v3.pdf, cover letter');

  await req('DELETE', `/api/applications/${application.id}`);
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

test('a multi-day event keeps its span and its own word for the kind', async () => {
  const body = {
    title: 'SHPE National Convention',
    kind: 'other',
    kind_label: 'Convention',
    starts_at: '2026-10-28T14:00:00Z',
    ends_at: '2026-11-01T23:59:00Z',
  };
  const { event } = await (await req('POST', '/api/events', { body })).json();
  assert.strictEqual(event.kind_label, 'Convention');
  assert.strictEqual(new Date(event.ends_at).toISOString(), '2026-11-01T23:59:00.000Z');

  const { events } = await (await req('GET', '/api/events')).json();
  assert.ok(events.some((e) => e.id === event.id && e.ends_at));

  const backwards = { ...body, ends_at: '2026-10-27T00:00:00Z' };
  assert.strictEqual((await req('POST', '/api/events', { body: backwards })).status, 400);
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

test('usernames are unique case-insensitively and validated', async () => {
  const name = uname();
  const first = await req('POST', '/api/auth/register', {
    body: { email: `uname-a-${uid()}@example.com`, password: 'password123', username: name },
    auth: null,
  });
  assert.strictEqual(first.status, 201);

  // Upper-cased: a plain unique constraint would let this through, and then two accounts
  // render identically on a leaderboard. The index is on lower(username) for this reason.
  const dupe = await req('POST', '/api/auth/register', {
    body: { email: `uname-b-${uid()}@example.com`, password: 'password123', username: name.toUpperCase() },
    auth: null,
  });
  assert.strictEqual(dupe.status, 409);
  assert.match((await dupe.json()).error, /username/, 'must name the field that actually clashed');

  // Format is a pure function, so it gets checked directly. Sending five bad registrations
  // over HTTP just to watch zod say no burns the auth rate limit and proves nothing extra.
  for (const username of ['ab', 'a'.repeat(21), 'has space', 'has-dash', 'emoji🙂', '']) {
    assert.strictEqual(
      registration.safeParse({ email: 'a@b.com', password: 'password123', username }).success,
      false,
      `should reject ${JSON.stringify(username)}`,
    );
  }
  assert.ok(registration.safeParse({ email: 'a@b.com', password: 'password123', username: 'emi_99' }).success);

  await db.query('delete from users where email like $1', ['uname-%@example.com']);
});

test('/auth/me returns the username, and a duplicate email still says email', async () => {
  const { user } = await (await req('GET', '/api/auth/me')).json();
  assert.match(user.username, /^u[a-z0-9]+$/);

  const res = await req('POST', '/api/auth/register', {
    body: { email, password: 'password123', username: uname() },
    auth: null,
  });
  assert.strictEqual(res.status, 409);
  assert.match((await res.json()).error, /email/);
});

test('bootstrap returns one payload equal to what the individual routes return', async () => {
  const d = today();
  const boot = await (await req('GET', `/api/bootstrap?today=${d}`)).json();

  // The point of the endpoint is that it is not a second implementation. If these ever
  // disagree, the dashboard silently renders different data than the routes it writes to.
  const [habits, applications, events, goals, connections, interviews, weekly] = await Promise.all(
    [`/api/habits?today=${d}`, '/api/applications', '/api/events', '/api/goals',
     '/api/connections', '/api/interview-answers', `/api/review/weekly?today=${d}`]
      .map(async (p) => (await req('GET', p)).json()),
  );

  assert.deepStrictEqual(boot.habits, habits.habits);
  assert.deepStrictEqual(boot.applications, applications.applications);
  assert.deepStrictEqual(boot.events, events.events);
  assert.deepStrictEqual(boot.goals, goals.goals);
  assert.deepStrictEqual(boot.connections, connections.connections);
  assert.deepStrictEqual(boot.interview_answers, interviews.interview_answers);
  assert.deepStrictEqual(boot.weekly, weekly);

  const me = await (await req('GET', '/api/auth/me')).json();
  // Bootstrap's user carries exactly one deliberate extra: the AI cap, which is server
  // config rather than a users column. Named here so any OTHER drift still fails.
  const { ai_monthly_cap, ...bootUser } = boot.user;
  assert.strictEqual(typeof ai_monthly_cap, 'number');
  assert.deepStrictEqual(bootUser, me.user);
  assert.ok(!('password_hash' in boot.user));

  assert.strictEqual((await req('GET', '/api/bootstrap', { auth: null })).status, 401);
  assert.strictEqual((await req('GET', '/api/bootstrap?today=nope')).status, 400);
});

test('a GitHub account can only be connected to one user', async () => {
  const name = `GhTest${uid().replace(/[^a-zA-Z0-9]/g, '')}`;
  const mine = await req('PUT', '/api/github/username', { body: { username: name } });
  assert.strictEqual(mine.status, 200);

  // Different case on purpose: GitHub usernames are case-insensitive, so EmiBustos and
  // emibustos are the same person and must collide here too (index on lower()).
  const theirs = await req('PUT', '/api/github/username', {
    body: { username: name.toLowerCase() },
    auth: otherToken,
  });
  assert.strictEqual(theirs.status, 409);
  assert.match((await theirs.json()).error, /already connected/);

  // The refused user is left untouched, and disconnect frees the name.
  await req('DELETE', '/api/github/username');
  const retry = await req('PUT', '/api/github/username', { body: { username: name }, auth: otherToken });
  assert.strictEqual(retry.status, 200);
  await req('DELETE', '/api/github/username', { auth: otherToken });
});

test('register issues no token — the session comes from the emailed link', async () => {
  const res = await req('POST', '/api/auth/register', {
    body: { email: `strict-${uid()}@example.com`, password: 'password123', username: uname() },
    auth: null,
  });
  assert.strictEqual(res.status, 201);
  const body = await res.json();
  // A token here would let whoever typed the address use the account before anyone
  // proved they can read the inbox — the exact thing verification-gated login prevents.
  assert.ok(!('token' in body), 'no token before verification');
  assert.ok(body.verify_sent);
  assert.ok(!JSON.stringify(body).includes('password_hash'));
  await db.query('delete from users where email = $1', [body.email]);
});

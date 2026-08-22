// Integration tests for connections + the AI routes. Needs docker compose up -d.
// The AI path is exercised with a stubbed client so the happy path, the no-key path,
// and an upstream failure are all covered without an API key or a billed call.
const { test, before, after } = require('node:test');
const assert = require('node:assert');

// Usernames are unique too, so tests need a fresh one per account.
const uname = () => `u${Math.random().toString(36).slice(2, 10)}`;
const uid = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
const app = require('./index');
const db = require('./db');
const ai = require('./ai');

const email = `conn-${uid()}@example.com`;
const other = `conn-other-${uid()}@example.com`;
let base, server, token, otherToken, connectionId, messageId;

const req = (method, path, { body, auth = token } = {}) =>
  fetch(base + path, {
    method,
    headers: { 'content-type': 'application/json', ...(auth && { authorization: `Bearer ${auth}` }) },
    ...(body && !['GET', 'HEAD'].includes(method) && { body: JSON.stringify(body) }),
  });

const { register: sharedRegister } = require('./testutil');
const register = (e) => sharedRegister(base, e);

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

test('creates a connection with notes and a draft', async () => {
  const created = await req('POST', '/api/connections', {
    body: { name: 'Sarah Chen', company: 'Stripe', role: 'SWE', relationship: 'engineer' },
  });
  assert.strictEqual(created.status, 201);
  ({ connection: { id: connectionId } } = await created.json());

  assert.strictEqual((await req('POST', `/api/connections/${connectionId}/notes`, { body: { body: 'Gave a payments talk' } })).status, 201);

  const msg = await req('POST', `/api/connections/${connectionId}/messages`, { body: { draft: 'hey, would love to chat' } });
  assert.strictEqual(msg.status, 201);
  ({ message: { id: messageId } } = await msg.json());

  const detail = await (await req('GET', `/api/connections/${connectionId}`)).json();
  assert.strictEqual(detail.notes.length, 1);
  assert.strictEqual(detail.messages.length, 1);
});

test('rejects bad input', async () => {
  for (const body of [{ name: '  ' }, { name: 'x', relationship: 'friend' }, { name: 'x', email: 'not-an-email' }]) {
    assert.strictEqual((await req('POST', '/api/connections', { body })).status, 400, JSON.stringify(body));
  }
  assert.strictEqual((await req('POST', `/api/connections/${connectionId}/notes`, { body: { body: '' } })).status, 400);
});

test('marking a message sent records when the person was last contacted', async () => {
  await req('PATCH', `/api/connections/${connectionId}/messages/${messageId}`, { body: { sent: true } });
  const { rows } = await db.query('select last_contacted_on from connections where id = $1', [connectionId]);
  assert.ok(rows[0].last_contacted_on, 'last_contacted_on should be set');
});

test('editing a draft clears its cached review', async () => {
  // Otherwise you would see a review of text that no longer exists.
  await db.query(`update outreach_messages set review_json = '{"verdict":"send"}', reviewed_at = now() where id = $1`, [messageId]);
  await req('PATCH', `/api/connections/${connectionId}/messages/${messageId}`, { body: { draft: 'a different draft entirely' } });
  const { rows } = await db.query('select review_json, reviewed_at from outreach_messages where id = $1', [messageId]);
  assert.strictEqual(rows[0].review_json, null);
  assert.strictEqual(rows[0].reviewed_at, null);
});

test('AI routes return an actionable 503 when no key is configured', async () => {
  if (ai.isConfigured()) return; // a real key is set — the live path is covered elsewhere
  const res = await req('POST', '/api/ai/review-message', { body: { draft: 'hey there, I wanted to reach out about an opportunity' } });
  assert.strictEqual(res.status, 503);
  const { error } = await res.json();
  assert.match(error, /ANTHROPIC_API_KEY/, 'the message must say how to fix it');

  const status = await (await req('GET', '/api/ai/status')).json();
  assert.strictEqual(status.configured, false);
});

test('AI review succeeds and caches when the model answers', async (t) => {
  const fake = {
    verdict: 'revise',
    strengths: ['Short'],
    issues: [{ quote: 'pick your brain', problem: 'No concrete ask.', fix: 'Ask for 15 minutes.' }],
    rewrite: 'Hi Sarah — ...',
  };
  t.mock.method(ai, 'complete', async () => ({ result: fake, usage: { input_tokens: 100, output_tokens: 200 } }));

  const res = await req('POST', `/api/ai/review-message/${messageId}`);
  assert.strictEqual(res.status, 200);
  const body = await res.json();
  assert.deepStrictEqual(body.review, fake);
  assert.strictEqual(body.cached, false);

  // Second call must be served from the row — a re-review is a second bill.
  const again = await (await req('POST', `/api/ai/review-message/${messageId}`)).json();
  assert.strictEqual(again.cached, true);
  assert.strictEqual(ai.complete.mock.callCount(), 1, 'must not call the API twice');
});

test('an upstream failure is surfaced as 502, not 500', async (t) => {
  t.mock.method(ai, 'complete', async () => {
    throw new ai.AIError('Could not reach Anthropic: socket hang up');
  });
  const res = await req('POST', '/api/ai/review-message', { body: { draft: 'hey there, I wanted to reach out about an opportunity' } });
  assert.strictEqual(res.status, 502, 'their outage is not our bug');
});

test('another user cannot see or touch these connections', async () => {
  const { connections } = await (await req('GET', '/api/connections', { auth: otherToken })).json();
  assert.deepStrictEqual(connections, []);

  // 404 everywhere, including the child routes — a 403 would confirm the row exists.
  for (const [method, path, body] of [
    ['GET', `/api/connections/${connectionId}`, null],
    ['PATCH', `/api/connections/${connectionId}`, { name: 'HACKED' }],
    ['DELETE', `/api/connections/${connectionId}`, null],
    ['POST', `/api/connections/${connectionId}/notes`, { body: 'snooping' }],
    ['POST', `/api/connections/${connectionId}/messages`, { draft: 'snooping' }],
    ['PATCH', `/api/connections/${connectionId}/messages/${messageId}`, { draft: 'hacked draft' }],
    ['DELETE', `/api/connections/${connectionId}/messages/${messageId}`, null],
  ]) {
    const res = await req(method, path, { body, auth: otherToken });
    assert.strictEqual(res.status, 404, `${method} ${path} should be 404`);
  }

  const { rows } = await db.query('select name from connections where id = $1', [connectionId]);
  assert.strictEqual(rows[0].name, 'Sarah Chen', 'untouched');
});

test("another user's connection_id contributes no context to a review", async (t) => {
  // Passing someone else's id must not leak their notes into the prompt.
  let captured = null;
  t.mock.method(ai, 'complete', async (built) => {
    captured = built.user;
    return { result: { verdict: 'send', strengths: [], issues: [], rewrite: 'x' }, usage: {} };
  });
  await req('POST', '/api/ai/review-message', {
    body: { draft: 'hey there, I wanted to reach out about an opportunity', connection_id: connectionId },
    auth: otherToken,
  });
  assert.doesNotMatch(captured, /Sarah Chen/, "must not leak another user's connection");
  assert.doesNotMatch(captured, /payments talk/);
});

// The token bucket is pure arithmetic — no server or DB needed to prove it.
const { test } = require('node:test');
const assert = require('node:assert');
const rateLimit = require('./middleware/rateLimit');

const fakeRes = () => ({
  code: null, body: null, headers: {},
  status(c) { this.code = c; return this; },
  json(b) { this.body = b; return this; },
  set(k, v) { this.headers[k] = v; return this; },
});

const hit = (limiter, ip = '1.1.1.1') => {
  const res = fakeRes();
  let passed = false;
  limiter({ ip, headers: {} }, res, () => { passed = true; });
  return { passed, res };
};

test('allows exactly `capacity` requests, then 429s', () => {
  const limiter = rateLimit({ capacity: 3, refillPerSec: 0 });
  assert.ok(hit(limiter).passed);
  assert.ok(hit(limiter).passed);
  assert.ok(hit(limiter).passed);

  const fourth = hit(limiter);
  assert.ok(!fourth.passed);
  assert.strictEqual(fourth.res.code, 429);
  assert.ok(fourth.res.headers['Retry-After'], 'must tell the client when to come back');
});

test('refills over time', async () => {
  const limiter = rateLimit({ capacity: 1, refillPerSec: 20 }); // one per 50ms
  assert.ok(hit(limiter, '2.2.2.2').passed);
  assert.ok(!hit(limiter, '2.2.2.2').passed, 'bucket is empty');

  await new Promise((r) => setTimeout(r, 80));
  assert.ok(hit(limiter, '2.2.2.2').passed, 'should have refilled');
});

test('buckets are per-key — one user cannot lock out another', () => {
  const limiter = rateLimit({ capacity: 1, refillPerSec: 0 });
  assert.ok(hit(limiter, 'alice').passed);
  assert.ok(!hit(limiter, 'alice').passed);
  assert.ok(hit(limiter, 'bob').passed, "bob's bucket is his own");
});

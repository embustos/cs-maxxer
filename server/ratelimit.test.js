// The refill maths is pure arithmetic — no server or DB needed to prove it. The limiter
// itself now consults Redis first (falling back to an in-process Map), so driving it is
// async; the behaviour asserted below is identical either way, which is the point.
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const rateLimit = require('./middleware/rateLimit');
const cache = require('./cache');

// Unique per run, so a re-run never inherits a bucket Redis is still holding.
const k = (name) => `${name}-${process.pid}-${Math.random().toString(36).slice(2, 8)}`;

before(() => cache.connect());
after(() => cache.quit());

const fakeRes = () => ({
  code: null, body: null, headers: {},
  status(c) { this.code = c; return this; },
  json(b) { this.body = b; return this; },
  set(key, v) { this.headers[key] = v; return this; },
});

const hit = async (limiter, ip) => {
  const res = fakeRes();
  let passed = false;
  await limiter({ ip, headers: {} }, res, () => { passed = true; });
  return { passed, res };
};

test('refill is pure arithmetic', () => {
  // empty bucket, 10/sec, one second later -> 10 tokens, capped at capacity
  assert.strictEqual(rateLimit.refill(0, 1000, 2000, 20, 10), 10);
  assert.strictEqual(rateLimit.refill(0, 1000, 2000, 5, 10), 5, 'never exceeds capacity');
  assert.strictEqual(rateLimit.refill(3, 1000, 1000, 20, 10), 3, 'no time passed, no refill');
});

test('allows exactly `capacity` requests, then 429s', async () => {
  const limiter = rateLimit({ capacity: 3, refillPerSec: 0 });
  const ip = k('cap');
  assert.ok((await hit(limiter, ip)).passed);
  assert.ok((await hit(limiter, ip)).passed);
  assert.ok((await hit(limiter, ip)).passed);

  const fourth = await hit(limiter, ip);
  assert.ok(!fourth.passed);
  assert.strictEqual(fourth.res.code, 429);
  assert.ok(fourth.res.headers['Retry-After'], 'must tell the client when to come back');
});

test('refills over time', async () => {
  const limiter = rateLimit({ capacity: 1, refillPerSec: 20 }); // one per 50ms
  const ip = k('refill');
  assert.ok((await hit(limiter, ip)).passed);
  assert.ok(!(await hit(limiter, ip)).passed, 'bucket is empty');

  await new Promise((r) => setTimeout(r, 80));
  assert.ok((await hit(limiter, ip)).passed, 'should have refilled');
});

test('buckets are per-key — one user cannot lock out another', async () => {
  const limiter = rateLimit({ capacity: 1, refillPerSec: 0 });
  const alice = k('alice');
  const bob = k('bob');
  assert.ok((await hit(limiter, alice)).passed);
  assert.ok(!(await hit(limiter, alice)).passed);
  assert.ok((await hit(limiter, bob)).passed, "bob's bucket is his own");
});

// The reason the bucket moved out of process memory: a limit that resets on deploy is
// not a limit. Two independently-created limiters stand in for two server instances.
test('the bucket is shared across instances', async () => {
  const ip = k('shared');
  const one = rateLimit({ capacity: 2, refillPerSec: 0 });
  const two = rateLimit({ capacity: 2, refillPerSec: 0 });

  assert.ok((await hit(one, ip)).passed);
  assert.ok((await hit(two, ip)).passed, 'second instance sees the same bucket');
  assert.ok(!(await hit(one, ip)).passed, 'and the two together exhaust it');
});

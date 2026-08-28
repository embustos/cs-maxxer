// Stale-while-revalidate is the whole point of the cache layer, and it is the one part
// that can fail silently — a broken background refresh still returns a plausible answer,
// just a permanently old one. These prove the three behaviours that matter.
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const cache = require('./cache');

const KEY = `test:swr:${process.pid}`;
const iso = (secsAgo) => new Date(Date.now() - secsAgo * 1000).toISOString();

// The background refresh is fire-and-forget by design, so the test has to wait for it.
const until = async (predicate, ms = 2000) => {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (await predicate()) return true;
    await new Promise((r) => setTimeout(r, 20));
  }
  return false;
};

before(() => cache.connect());
after(async () => {
  await cache.del(KEY);
  await cache.del(`${KEY}:refreshing`);
  await cache.quit();
});

test('a fresh copy is served without running produce', async () => {
  await cache.del(KEY);
  await cache.set(KEY, { v: 'old', fetched_at: iso(60) }, 60);

  let ran = 0;
  const got = await cache.remember(KEY, 3600, 15 * 60, async () => (ran++, { v: 'new' }));

  assert.equal(got.v, 'old');
  assert.equal(got.cached, true);
  assert.equal(ran, 0, 'produce must not run for a copy inside the freshness line');
});

test('a stale copy is served immediately, then refreshed in the background', async () => {
  await cache.del(KEY);
  await cache.del(`${KEY}:refreshing`);
  await cache.set(KEY, { v: 'old', fetched_at: iso(20 * 60) }, 3600);

  const got = await cache.remember(KEY, 3600, 15 * 60, async () => {
    await new Promise((r) => setTimeout(r, 50)); // slower than the response we just got
    return { v: 'new', fetched_at: iso(0) };
  });

  // The caller did NOT wait for produce — this is the behaviour the feature exists for.
  assert.equal(got.v, 'old');
  assert.equal(got.cached, true);

  assert.ok(
    await until(async () => (await cache.get(KEY))?.v === 'new'),
    'the background refresh should have replaced the cached copy',
  );
});

test('concurrent readers of a stale copy trigger exactly one refresh', async () => {
  await cache.del(KEY);
  await cache.del(`${KEY}:refreshing`);
  await cache.set(KEY, { v: 'old', fetched_at: iso(20 * 60) }, 3600);

  let ran = 0;
  const produce = async () => {
    ran++;
    await new Promise((r) => setTimeout(r, 50));
    return { v: 'new', fetched_at: iso(0) };
  };

  const all = await Promise.all(
    Array.from({ length: 5 }, () => cache.remember(KEY, 3600, 15 * 60, produce)),
  );

  assert.ok(all.every((r) => r.v === 'old'), 'every caller gets the cached copy, nobody waits');
  await until(async () => (await cache.get(KEY))?.v === 'new');
  assert.equal(ran, 1, 'the NX lock should collapse five refreshes into one');
});

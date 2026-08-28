// Redis in front of slow/limited things — currently the GitHub API.
//
// Why Redis and not a plain Map: a Map dies on restart and is not shared between
// server processes. Run two copies of this app behind a load balancer and each keeps
// its own half-cold cache. Redis is one cache all of them share, and it survives deploys.
const { createClient } = require('redis');
const config = require('./config');

const client = createClient({ url: config.redisUrl });
let connected = false;

// A cache is an OPTIMIZATION. If Redis is down the app must still work, just slower —
// so every failure here is logged and swallowed rather than thrown.
client.on('error', (err) => {
  if (connected) console.error(JSON.stringify({ level: 'error', msg: 'redis error', err: err.message }));
  connected = false;
});

async function connect() {
  if (!client.isOpen) await client.connect();
  connected = true;
}

async function get(key) {
  try {
    if (!client.isOpen) return null;
    const raw = await client.get(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null; // treat a broken cache as an empty one
  }
}

async function set(key, value, ttlSeconds) {
  try {
    if (!client.isOpen) return;
    await client.set(key, JSON.stringify(value), { EX: ttlSeconds });
  } catch {
    /* ignore — never fail a request because the cache is unhappy */
  }
}

// The pattern in one function: look, else compute, then remember — plus a freshness line.
//
// TTL is the CEILING (how long a copy may exist at all); `fetched_at` on the payload is
// the freshness line. A copy past that line is still served immediately and refreshed
// behind the request, so nobody waits on the upstream just because a clock ticked over.
// "Wrong for at most `freshFor` seconds, and never blocking on it" is the tradeoff.
async function remember(key, ttlSeconds, freshForSeconds, produce) {
  const hit = await get(key);
  if (hit === null) {
    const fresh = await produce();
    await set(key, fresh, ttlSeconds);
    return { ...fresh, cached: false };
  }
  // `|| 0` on purpose: a copy with no parseable fetched_at reads as infinitely old and
  // refreshes. Failing toward "refresh" beats failing toward "never refresh again".
  const age = (Date.now() - (Date.parse(hit.fetched_at) || 0)) / 1000;
  if (age > freshForSeconds) void refreshOnce(key, ttlSeconds, produce); // not awaited — the point
  return { ...hit, cached: true };
}

// One refresher per key at a time, or every request arriving during the gap fires its own
// upstream call. SET NX is the lock and its EX is the lease, so a refresher that dies
// mid-flight frees the key instead of wedging it forever.
//
// ponytail: per-key lock, 60s lease. Long enough for a call the caller already times out
// at 5s; raise it only if some future producer legitimately runs longer.
async function refreshOnce(key, ttlSeconds, produce) {
  const lock = `${key}:refreshing`;
  try {
    if (!client.isOpen) return;
    if (!(await client.set(lock, '1', { NX: true, EX: 60 }))) return;
    await set(key, await produce(), ttlSeconds);
  } catch {
    /* a failed background refresh just means the cached copy lives a little longer */
  } finally {
    await del(lock);
  }
}

const del = async (key) => {
  try {
    if (client.isOpen) await client.del(key);
  } catch {
    /* ignore */
  }
};

module.exports = { client, connect, get, set, del, remember, quit: () => client.isOpen && client.quit() };

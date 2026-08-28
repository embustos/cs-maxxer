// Redis in front of slow/limited things — currently the GitHub API.
//
// Why Redis and not a plain Map: a Map dies on restart and is not shared between
// server processes. Run two copies of this app behind a load balancer and each keeps
// its own half-cold cache. Redis is one cache all of them share, and it survives deploys.
const { createClient } = require('redis');
const config = require('./config');

// Two settings, both about what happens when Redis is NOT there.
//
//   connectTimeout   without it, connect() waits on an unreachable host indefinitely
//   disableOfflineQueue  without it, every command issued while the socket is down is
//                        QUEUED rather than rejected, and the request waiting on it
//                        hangs for as long as the reconnect keeps trying
//
// That queueing is what turns "cache is down" into "site takes 13 seconds", which is the
// opposite of what a cache is for. Rejecting immediately is what makes the swallowed
// errors below mean "no cache" instead of "wait here".
const client = createClient({
  url: config.redisUrl,
  disableOfflineQueue: true,
  socket: {
    connectTimeout: 2000,
    // Keep trying forever so the cache heals on its own, but back off instead of
    // spinning, and never let a reconnect attempt block a request.
    reconnectStrategy: (retries) => Math.min(retries * 200, 5000),
  },
});
let connected = false;

// A cache is an OPTIMIZATION. If Redis is down the app must still work, just slower —
// so every failure here is logged and swallowed rather than thrown.
client.on('error', (err) => {
  if (connected) console.error(JSON.stringify({ level: 'error', msg: 'redis error', err: err.message }));
  connected = false;
});

// Bounded, because the reconnectStrategy above never gives up — without the race an
// awaiting caller waits forever on an unreachable host. Losing the race is not fatal:
// the attempt keeps running in the background, so the cache still heals by itself.
async function connect() {
  if (client.isOpen) return void (connected = true);
  const attempt = client.connect();
  attempt.catch(() => {}); // the race can reject first; don't leave this one unhandled
  await Promise.race([
    attempt,
    new Promise((_, reject) => setTimeout(() => reject(new Error('redis connect timed out')), 3000)),
  ]);
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

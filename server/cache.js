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

// The pattern in one function: look, else compute, then remember.
// TTL *is* our invalidation strategy — "wrong for at most N seconds" is a deliberate,
// stated tradeoff, and it is the only invalidation that cannot leak stale data forever.
async function remember(key, ttlSeconds, produce) {
  const hit = await get(key);
  if (hit !== null) return { ...hit, cached: true };
  const fresh = await produce();
  await set(key, fresh, ttlSeconds);
  return { ...fresh, cached: false };
}

const del = async (key) => {
  try {
    if (client.isOpen) await client.del(key);
  } catch {
    /* ignore */
  }
};

module.exports = { client, connect, get, set, del, remember, quit: () => client.isOpen && client.quit() };

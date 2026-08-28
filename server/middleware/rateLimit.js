// Token bucket, by hand — the roadmap names the algorithm, so implementing it is the point.
//
// The bucket holds `capacity` tokens and refills at `refillPerSec`. Each request spends
// one. Empty bucket → 429. Two properties fall out of this that a naive counter lacks:
//   * bursts are allowed (a full bucket absorbs `capacity` requests at once)
//   * the long-run average is still capped at the refill rate
// A fixed window ("100 per minute") instead allows 200 requests across a window
// boundary, and resets in a cliff that clients synchronize onto.
//
// The bucket lives in Redis, with an in-process Map as the fallback. That split is the
// whole design: a Map is correct for ONE process and forgets everything on deploy, so a
// bot only has to wait for your next push to get a fresh budget. Redis is one bucket
// every instance shares and it survives restarts. But a rate limiter that 500s when the
// cache blinks is worse than one that undercounts, so losing Redis degrades to the Map
// rather than failing the request.
const cache = require('../cache');

const buckets = new Map();

// Refill for the time that has passed since we last looked. No background timer — the
// arithmetic is exact and costs nothing when nobody is calling. Pure, so it can be
// tested without a server, and so the Lua below is a transcription rather than a design.
function refill(tokens, last, now, capacity, refillPerSec) {
  return Math.min(capacity, tokens + ((now - last) / 1000) * refillPerSec);
}

// Read-modify-write has to be ONE step or two instances both see "1 token left" and both
// spend it. Lua runs atomically inside Redis, which is what makes the shared bucket real.
const CONSUME = `
local b = redis.call('HMGET', KEYS[1], 'tokens', 'last')
local capacity, rate, now = tonumber(ARGV[1]), tonumber(ARGV[2]), tonumber(ARGV[3])
local tokens = tonumber(b[1])
local last = tonumber(b[2])
if tokens == nil then tokens = capacity; last = now end
tokens = math.min(capacity, tokens + ((now - last) / 1000) * rate)
local allowed = 0
if tokens >= 1 then tokens = tokens - 1; allowed = 1 end
redis.call('HSET', KEYS[1], 'tokens', tokens, 'last', now)
redis.call('PEXPIRE', KEYS[1], tonumber(ARGV[4]))
return { allowed, tostring(tokens) }`;

// Returns { allowed, tokens }, or null when Redis could not answer — the caller then
// falls back to the local Map rather than guessing.
async function consumeShared(id, capacity, refillPerSec, ttlMs) {
  try {
    if (!cache.client.isOpen) return null;
    const [allowed, tokens] = await cache.client.eval(CONSUME, {
      keys: [`rl:${id}`],
      arguments: [String(capacity), String(refillPerSec), String(Date.now()), String(ttlMs)],
    });
    return { allowed: allowed === 1, tokens: Number(tokens) };
  } catch {
    return null; // treat a broken cache as no cache, never as a denial
  }
}

function consumeLocal(id, capacity, refillPerSec) {
  const now = Date.now();
  const b = buckets.get(id) ?? { tokens: capacity, last: now };
  b.tokens = refill(b.tokens, b.last, now, capacity, refillPerSec);
  b.last = now;
  const allowed = b.tokens >= 1;
  if (allowed) b.tokens -= 1;
  buckets.set(id, b);
  return { allowed, tokens: b.tokens };
}

function rateLimit({ capacity, refillPerSec, key = (req) => req.ip, message = 'too many requests' }) {
  // How long an idle bucket is worth remembering: the time to refill from empty, plus
  // slack. Shorter and we'd hand out free capacity by forgetting; longer just wastes RAM.
  const ttlMs = refillPerSec > 0 ? Math.ceil((capacity / refillPerSec) * 1000) + 60_000 : 3_600_000;

  return async (req, res, next) => {
    const id = key(req);
    const { allowed, tokens } = (await consumeShared(id, capacity, refillPerSec, ttlMs))
      ?? consumeLocal(id, capacity, refillPerSec);

    if (allowed) return next();

    const waitSec = refillPerSec > 0 ? Math.ceil((1 - tokens) / refillPerSec) : 3600;
    res.set('Retry-After', String(waitSec));
    return res.status(429).json({ error: message, retry_after_seconds: waitSec });
  };
}

// Without this the Map grows one entry per IP forever — a slow memory leak that only
// shows up in production. (Redis buckets expire on their own, via PEXPIRE above.)
const sweep = setInterval(() => {
  const cutoff = Date.now() - 60 * 60 * 1000;
  for (const [id, b] of buckets) if (b.last < cutoff) buckets.delete(id);
}, 10 * 60 * 1000);
sweep.unref(); // don't hold the process open

module.exports = rateLimit;
module.exports.refill = refill;
module.exports._buckets = buckets; // for tests

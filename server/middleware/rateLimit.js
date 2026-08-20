// Token bucket, by hand — the roadmap names the algorithm, so implementing it is the point.
//
// The bucket holds `capacity` tokens and refills at `refillPerSec`. Each request spends
// one. Empty bucket → 429. Two properties fall out of this that a naive counter lacks:
//   * bursts are allowed (a full bucket absorbs `capacity` requests at once)
//   * the long-run average is still capped at the refill rate
// A fixed window ("100 per minute") instead allows 200 requests across a window
// boundary, and resets in a cliff that clients synchronize onto.
//
// ponytail: in-process Map. Correct for one server; each process keeps its own buckets,
// so N servers means N× the limit. Move the bucket into Redis when you run more than one.
const buckets = new Map();

function rateLimit({ capacity, refillPerSec, key = (req) => req.ip, message = 'too many requests' }) {
  return (req, res, next) => {
    const id = key(req);
    const now = Date.now();
    const bucket = buckets.get(id) ?? { tokens: capacity, last: now };

    // Refill for the time that has passed since we last looked. No background timer —
    // the arithmetic is exact and costs nothing when nobody is calling.
    bucket.tokens = Math.min(capacity, bucket.tokens + ((now - bucket.last) / 1000) * refillPerSec);
    bucket.last = now;

    if (bucket.tokens < 1) {
      buckets.set(id, bucket);
      const waitSec = Math.ceil((1 - bucket.tokens) / refillPerSec);
      res.set('Retry-After', String(waitSec));
      return res.status(429).json({ error: message, retry_after_seconds: waitSec });
    }

    bucket.tokens -= 1;
    buckets.set(id, bucket);
    next();
  };
}

// Without this the Map grows one entry per IP forever — a slow memory leak that only
// shows up in production.
const sweep = setInterval(() => {
  const cutoff = Date.now() - 60 * 60 * 1000;
  for (const [id, b] of buckets) if (b.last < cutoff) buckets.delete(id);
}, 10 * 60 * 1000);
sweep.unref(); // don't hold the process open

module.exports = rateLimit;
module.exports._buckets = buckets; // for tests

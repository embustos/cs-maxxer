// Structured logging: one JSON object per line, not human prose.
//
// `console.log('user ' + id + ' did a thing')` is unsearchable at volume. JSON lines are
// queryable — every log aggregator (Datadog, CloudWatch, Loki) parses them for free:
//     level=error status>=500 | count by route
//
// Every log line carries a request id, so when a user reports "it broke at 3pm" you can
// pull every line for that one request, in order, out of thousands.
const crypto = require('crypto');

const log = (fields) => console.log(JSON.stringify({ time: new Date().toISOString(), ...fields }));

function requestLogger(req, res, next) {
  // Honor an upstream id if there is one, so a request keeps its identity across services.
  req.id = req.headers['x-request-id'] ?? crypto.randomUUID();
  res.set('X-Request-Id', req.id);
  const started = process.hrtime.bigint();

  // 'finish' fires once the response is fully sent — that's when duration is real.
  res.on('finish', () => {
    const ms = Number(process.hrtime.bigint() - started) / 1e6;
    log({
      level: res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info',
      msg: 'request',
      id: req.id,
      method: req.method,
      // req.route strips the ids out: "/api/habits/:id" not "/api/habits/318", so logs
      // group by endpoint instead of scattering across every id ever requested.
      // When middleware answers before routing (a 429, say) there is no req.route —
      // fall back to baseUrl + path, never bare req.path, which is mount-relative and
      // would log "/login" for what was really "/api/auth/login".
      path: req.baseUrl + (req.route ? req.route.path : req.path),
      status: res.statusCode,
      ms: Math.round(ms * 10) / 10,
      user: req.user?.id ?? null,
    });
  });
  next();
}

module.exports = { requestLogger, log };

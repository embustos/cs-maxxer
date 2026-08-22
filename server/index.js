const config = require('./config'); // validates env and exits early if something's missing
const express = require('express');
const cors = require('cors');
const cache = require('./cache');
const rateLimit = require('./middleware/rateLimit');
const { requestLogger, log } = require('./middleware/logger');

const app = express();

app.set('trust proxy', 1); // behind a host's proxy, req.ip must come from X-Forwarded-For
app.use(
  cors({
    origin:
      config.env === 'production'
        ? config.clientOrigin // an array; cors matches the request origin against each
        : (origin, cb) => cb(null, !origin || /^http:\/\/localhost:\d+$/.test(origin)),
  }),
);
// The Stripe webhook must see the EXACT bytes Stripe sent — its signature is an HMAC
// over the raw body, and json() would consume and re-serialize them. raw() marks the
// body as parsed, so the json() below skips this one path. Order is the whole trick.
app.use('/api/billing/webhook', express.raw({ type: 'application/json', limit: '100kb' }));
app.use(express.json({ limit: '100kb' })); // a body limit is a free DoS guard
app.use(requestLogger);

// Login is the one endpoint worth guessing against, so it gets a tight budget:
// 10 attempts, refilling at 1 every 5s. Normal humans never notice; a script does.
// Under `node --test` the budget is effectively off: the suite registers accounts and
// calls /auth/me dozens of times, and a 429 mid-suite tests the limiter's placement,
// not the code under test. The limiter's actual arithmetic has its own direct tests
// (ratelimit.test.js), so nothing is lost by widening it here.
const authLimit = rateLimit({
  capacity: process.env.NODE_TEST_CONTEXT ? 10_000 : 10,
  refillPerSec: 0.2,
  message: 'too many attempts — wait a moment',
});

app.get('/health', (req, res) => res.json({ ok: true }));

app.use('/api/auth', authLimit, require('./routes/auth'));
app.use('/api/bootstrap', require('./routes/bootstrap'));
app.use('/api/billing', require('./routes/billing'));
app.use('/api/habits', require('./routes/habits'));
app.use('/api/applications', require('./routes/applications'));
app.use('/api/events', require('./routes/events'));
app.use('/api/goals', require('./routes/goals'));
app.use('/api/github', require('./routes/github'));
app.use('/api/connections', require('./routes/connections'));
app.use('/api/ai', require('./routes/ai'));
app.use('/api/onboarding', require('./routes/onboarding'));
app.use('/api/interview-answers', require('./routes/interviews'));
app.use('/api/review', require('./routes/review'));

app.use((req, res) => res.status(404).json({ error: `no route for ${req.method} ${req.path}` }));

// Four arguments means "error handler" to express. Anything thrown or rejected in a
// route lands here instead of killing the process.
app.use((err, req, res, next) => {
  log({ level: 'error', msg: 'unhandled', id: req.id, err: err.message, stack: err.stack });
  // Never leak err.message to the client: stack traces and SQL text are a map of your
  // internals. The request id is the bridge — the user quotes it, you grep the logs.
  res.status(500).json({ error: 'internal server error', request_id: req.id });
});

if (require.main === module) {
  cache.connect().catch(() => log({ level: 'warn', msg: 'redis unavailable, running without cache' }));
  app.listen(config.port, () => log({ level: 'info', msg: 'listening', port: config.port, env: config.env }));
}

module.exports = app;

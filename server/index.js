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
        ? config.clientOrigin
        : (origin, cb) => cb(null, !origin || /^http:\/\/localhost:\d+$/.test(origin)),
  }),
);
app.use(express.json({ limit: '100kb' })); // a body limit is a free DoS guard
app.use(requestLogger);

// Login is the one endpoint worth guessing against, so it gets a tight budget:
// 10 attempts, refilling at 1 every 5s. Normal humans never notice; a script does.
const authLimit = rateLimit({
  capacity: 10,
  refillPerSec: 0.2,
  message: 'too many attempts — wait a moment',
});

app.get('/health', (req, res) => res.json({ ok: true }));

app.use('/api/auth', authLimit, require('./routes/auth'));
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

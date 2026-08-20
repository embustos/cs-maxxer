// Every environment variable is read HERE and nowhere else, and validated at startup.
//
// Two reasons this beats sprinkling process.env around:
//  1. A missing secret crashes on boot with a clear message, instead of at 2am when the
//     first request hits the one route that needed it.
//  2. There is exactly one place to look to answer "what config does this app need?"
require('dotenv').config();

function required(name) {
  const value = process.env[name];
  if (!value) {
    console.error(`\nMissing required env var: ${name}\nCopy .env.example to .env and fill it in.\n`);
    process.exit(1);
  }
  return value;
}

const config = {
  env: process.env.NODE_ENV ?? 'development',
  port: Number(process.env.PORT ?? 3000),
  // In dev, Vite hops to 5174/5175 whenever 5173 is taken — and a CORS block shows up
  // in the browser as a bare "Failed to fetch", which looks like the server is down.
  // So accept any localhost port locally. Production stays a strict allowlist.
  clientOrigin: process.env.CLIENT_ORIGIN ?? 'http://localhost:5173',

  jwtSecret: required('JWT_SECRET'),
  databaseUrl: required('DATABASE_URL'),
  redisUrl: process.env.REDIS_URL ?? 'redis://localhost:6379',

  // Optional. Without it the GitHub API still works, but at 60 requests/hour per IP
  // instead of 5000/hour. See docs/07-env-secrets.md for how to create one.
  githubToken: process.env.GITHUB_TOKEN ?? null,
  // Optional. Without it the review features return a 503 explaining how to enable
  // them; everything else in the app works untouched. See docs/07-env-secrets.md.
  anthropicApiKey: process.env.ANTHROPIC_API_KEY ?? null,
  resendApiKey: process.env.RESEND_API_KEY ?? null,
};

// A secret this weak in production means anyone can mint tokens for any account.
if (config.env === 'production' && config.jwtSecret.length < 32) {
  console.error('JWT_SECRET is too short for production (need 32+ chars)');
  process.exit(1);
}

module.exports = config;

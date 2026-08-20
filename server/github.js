// Talking to somebody else's server is where things actually break: it can be slow,
// down, rate-limiting you, or lying. Every call out of this process gets four things.
const config = require('./config');
const cache = require('./cache');

const TIMEOUT_MS = 5000;
const CACHE_TTL = 15 * 60; // GitHub contribution data doesn't change by the second

class GitHubError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

// 1. TIMEOUT. Without one, fetch waits ~forever. A hung upstream then holds your
//    connections open until your own server stops answering anyone — one slow
//    dependency takes down a service that was otherwise fine.
async function fetchJson(url) {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(TIMEOUT_MS),
    headers: {
      accept: 'application/vnd.github+json',
      'user-agent': 'cs-tracker',
      ...(config.githubToken && { authorization: `Bearer ${config.githubToken}` }),
    },
  });

  if (res.status === 404) throw new GitHubError('GitHub user not found', 404);
  if (res.status === 403 || res.status === 429) {
    // GitHub tells you when the window resets. Pass that on instead of guessing.
    const reset = res.headers.get('x-ratelimit-reset');
    const secs = reset ? Math.max(0, Number(reset) * 1000 - Date.now()) / 1000 : null;
    throw new GitHubError(
      `GitHub rate limit reached${secs ? `, resets in ${Math.ceil(secs / 60)} min` : ''}`,
      429,
    );
  }
  if (!res.ok) throw new GitHubError(`GitHub returned ${res.status}`, 502);
  return res.json();
}

// 2. RETRY, but only what retrying can fix. A 404 will be a 404 forever — retrying it
//    just wastes your rate limit. Timeouts and 5xx are worth another shot.
// 3. BACKOFF. Retrying instantly hammers a service that is already struggling. Waiting
//    longer each time gives it room to recover.
async function withRetry(fn, attempts = 3) {
  for (let i = 1; ; i++) {
    try {
      return await fn();
    } catch (err) {
      const retryable = err.name === 'TimeoutError' || err.status === 502 || err.status >= 500;
      if (!retryable || i >= attempts) throw err;
      await new Promise((r) => setTimeout(r, 2 ** i * 100)); // 200ms, 400ms
    }
  }
}

// Public events give us push activity without any token or scope.
async function fetchRecentCommits(username) {
  const events = await withRetry(() =>
    fetchJson(`https://api.github.com/users/${encodeURIComponent(username)}/events/public?per_page=100`),
  );

  // GitHub's public feed does not always include the commits array or a size — when
  // both are missing, count the push itself. Verified against the live API: payloads
  // there carry only {repository_id, push_id, ref, head, before}.
  const byDay = {};
  for (const e of events) {
    if (e.type !== 'PushEvent') continue;
    const day = e.created_at.slice(0, 10);
    byDay[day] = (byDay[day] ?? 0) + (e.payload?.size ?? e.payload?.commits?.length ?? 1);
  }

  const days = Object.keys(byDay).sort().reverse();
  return {
    username,
    total: Object.values(byDay).reduce((a, b) => a + b, 0),
    days_active: days.length,
    last_commit_on: days[0] ?? null,
    by_day: byDay,
    fetched_at: new Date().toISOString(),
  };
}

// 4. CACHE + FALLBACK. Cached for 15 minutes, so a dashboard refresh is free and we
//    stay far under the rate limit. If GitHub is down we serve the stale copy rather
//    than an error — a slightly old number beats a broken page.
async function getCommitActivity(username) {
  const key = `github:commits:${username.toLowerCase()}`;
  try {
    return await cache.remember(key, CACHE_TTL, async () => {
      const fresh = await fetchRecentCommits(username);
      // A second, week-long copy kept only as the fallback below.
      await cache.set(`${key}:stale`, fresh, 7 * 24 * 3600);
      return fresh;
    });
  } catch (err) {
    const stale = await cache.get(`${key}:stale`);
    if (stale) return { ...stale, cached: true, stale: true, error: err.message };
    throw err;
  }
}

module.exports = { getCommitActivity, fetchRecentCommits, GitHubError };

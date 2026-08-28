// Talking to somebody else's server is where things actually break: it can be slow,
// down, rate-limiting you, or lying. Every call out of this process gets four things.
const config = require('./config');
const cache = require('./cache');

const TIMEOUT_MS = 5000;
// Two lines, not one. CACHE_TTL is the ceiling on how long a copy may exist; FRESH_FOR is
// when we start refreshing it behind the request. Expiry is no longer how the data stays
// current — the background refresh is — so the ceiling only has to cover "user was away".
//
// ponytail: 24h ceiling. It bounds how stale a returning user's FIRST paint can be before
// the refresh lands; shorten it if that ever matters more than the extra cold fetch.
const CACHE_TTL = 24 * 3600;
const FRESH_FOR = 15 * 60; // GitHub contribution data doesn't change by the second

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

// ── Two ways to get the same data ────────────────────────────────────────────
// GraphQL gives the real contribution calendar — a full year, exact counts, the same
// numbers as the profile page. It requires a token. The public events feed needs no
// token but only reaches back ~90 days and only sees pushes.
//
// Both normalize to ONE shape so nothing downstream has to know which ran:
//   { username, days: {'2026-08-19': 4, ...}, total, days_active, last_commit_on,
//     from, to, source: 'graphql' | 'events' }
const YEAR_MS = 365 * 24 * 3600 * 1000;

const summarize = (byDay, extra) => {
  const dates = Object.keys(byDay).sort();
  return {
    days: byDay,
    total: Object.values(byDay).reduce((a, b) => a + b, 0),
    days_active: dates.filter((d) => byDay[d] > 0).length,
    last_commit_on: [...dates].reverse().find((d) => byDay[d] > 0) ?? null,
    fetched_at: new Date().toISOString(),
    ...extra,
  };
};

// GitHub's own definition of a "contribution" — commits, PRs, issues, reviews. Using
// their number rather than deriving our own is the point: it matches the profile page,
// so the user can check our work against a source they already trust.
const CALENDAR_QUERY = `query($login: String!, $from: DateTime!, $to: DateTime!) {
  user(login: $login) {
    contributionsCollection(from: $from, to: $to) {
      contributionCalendar {
        totalContributions
        weeks { contributionDays { date contributionCount } }
      }
    }
  }
}`;

async function fetchContributionCalendar(username) {
  const to = new Date();
  const from = new Date(to.getTime() - YEAR_MS);

  const res = await fetch('https://api.github.com/graphql', {
    method: 'POST',
    signal: AbortSignal.timeout(TIMEOUT_MS),
    headers: {
      authorization: `Bearer ${config.githubToken}`,
      'user-agent': 'cs-tracker',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      query: CALENDAR_QUERY,
      variables: { login: username, from: from.toISOString(), to: to.toISOString() },
    }),
  });

  if (res.status === 401) throw new GitHubError('GitHub token is invalid or expired', 401);
  if (!res.ok) throw new GitHubError(`GitHub GraphQL returned ${res.status}`, 502);

  const body = await res.json();
  // GraphQL answers 200 even when the query failed — the errors are in the body.
  if (body.errors?.length) {
    const msg = body.errors[0].message;
    throw new GitHubError(msg, /could not resolve|not exist/i.test(msg) ? 404 : 502);
  }
  const calendar = body.data?.user?.contributionsCollection?.contributionCalendar;
  if (!calendar) throw new GitHubError('GitHub user not found', 404);

  const byDay = {};
  for (const week of calendar.weeks) {
    for (const day of week.contributionDays) byDay[day.date] = day.contributionCount;
  }

  return summarize(byDay, {
    username,
    total: calendar.totalContributions, // trust GitHub's total over our own sum
    from: from.toISOString().slice(0, 10),
    to: to.toISOString().slice(0, 10),
    source: 'graphql',
  });
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

  const dates = Object.keys(byDay).sort();
  return summarize(byDay, {
    username,
    from: dates[0] ?? null,
    to: dates[dates.length - 1] ?? null,
    source: 'events',
  });
}

// Prefer the real calendar; fall back to events if there's no token, or if the token
// turns out to be bad — a stale/rejected token should degrade the feature, not break it.
async function fetchActivity(username) {
  if (!config.githubToken) return fetchRecentCommits(username);
  try {
    return await withRetry(() => fetchContributionCalendar(username));
  } catch (err) {
    if (err.status === 404) throw err; // a real "no such user" is worth surfacing
    return fetchRecentCommits(username);
  }
}

// 4. CACHE + FALLBACK. Served from Redis, refreshed in the background once the copy is
//    older than FRESH_FOR — so exactly one person per username ever waits on GitHub, the
//    first one. If GitHub is down we serve the week-old copy rather than an error: a
//    slightly old number beats a broken page.
async function getCommitActivity(username, { force = false } = {}) {
  const key = `github:commits:${username.toLowerCase()}`;
  const produce = async () => {
    const fresh = await fetchActivity(username);
    // A second, week-long copy kept only as the fallback below.
    await cache.set(`${key}:stale`, fresh, 7 * 24 * 3600);
    return fresh;
  };

  // A manual refresh drops the copy so the line below takes the cold path and the caller
  // actually waits for new data — which is the whole point of asking for it.
  if (force) await cache.del(key);

  try {
    return await cache.remember(key, CACHE_TTL, FRESH_FOR, produce);
  } catch (err) {
    const stale = await cache.get(`${key}:stale`);
    if (stale) return { ...stale, cached: true, stale: true, error: err.message };
    throw err;
  }
}

module.exports = { getCommitActivity, fetchActivity, fetchRecentCommits, fetchContributionCalendar, GitHubError };

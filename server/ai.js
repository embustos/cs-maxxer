// The one place this app talks to Claude.
//
// The API key lives here, on the server, and never anywhere else. The browser posts a
// draft to our API and we make the call — because anything bundled into client code is
// downloadable by anyone (docs/02-client-vs-server.md). A key in React is a published key.
const Anthropic = require('@anthropic-ai/sdk');
const config = require('./config');

const MODEL = 'claude-opus-5';
const TIMEOUT_MS = 60_000;

// Thinking is on by default on this model, and max_tokens caps thinking PLUS the
// response together — a tight limit truncates mid-review rather than erroring.
const MAX_TOKENS = 8000;

// A critique is not a hard reasoning task. 'medium' is the cost/quality sweet spot here;
// ponytail: raise to 'high' if reviews come back shallow.
const EFFORT = 'medium';

class AIUnavailableError extends Error {
  constructor() {
    super(
      'AI review is not configured. Add ANTHROPIC_API_KEY to server/.env and restart — ' +
        'see console.anthropic.com → API keys.',
    );
    this.status = 503;
  }
}

class AIError extends Error {
  constructor(message, status = 502) {
    super(message);
    this.status = status;
  }
}

const isConfigured = () => Boolean(config.anthropicApiKey);

// Constructed lazily so the server boots fine without a key — the feature is optional,
// so its absence must not be a startup failure.
let client = null;
const getClient = () => {
  if (!isConfigured()) throw new AIUnavailableError();
  client ??= new Anthropic({ apiKey: config.anthropicApiKey, timeout: TIMEOUT_MS });
  return client;
};

// Same retry shape as server/github.js: retry what a retry can fix, never a 4xx.
// A 400 means our request is wrong and will be wrong again; a 429 or 5xx might not be.
async function withRetry(fn, attempts = 2) {
  for (let i = 1; ; i++) {
    try {
      return await fn();
    } catch (err) {
      const status = err?.status;
      const retryable = status === 429 || status >= 500 || err?.name === 'APIConnectionError';
      if (!retryable || i >= attempts) throw err;
      await new Promise((r) => setTimeout(r, 2 ** i * 500));
    }
  }
}

/**
 * One structured call. `schema` is a JSON Schema; the response is guaranteed to match it,
 * so callers get a validated object instead of prose they have to parse.
 */
async function complete({ system, user, schema }) {
  const anthropic = getClient();

  try {
    const response = await withRetry(() =>
      anthropic.messages.create({
        model: MODEL,
        max_tokens: MAX_TOKENS,
        system,
        output_config: { effort: EFFORT, format: { type: 'json_schema', schema } },
        messages: [{ role: 'user', content: user }],
      }),
    );

    // Safety classifiers can decline a request — that arrives as a normal 200 with
    // stop_reason 'refusal', so check it before reading content or we'd read content[0]
    // of an empty array.
    if (response.stop_reason === 'refusal') {
      throw new AIError('The model declined to review this text.', 422);
    }
    if (response.stop_reason === 'max_tokens') {
      throw new AIError('The review was too long to finish. Try a shorter draft.', 422);
    }

    const text = response.content.find((b) => b.type === 'text')?.text;
    if (!text) throw new AIError('Empty response from the model.');

    return { result: JSON.parse(text), usage: response.usage };
  } catch (err) {
    if (err instanceof AIError || err instanceof AIUnavailableError) throw err;
    if (err?.status === 401) throw new AIError('ANTHROPIC_API_KEY is invalid or expired.', 502);
    if (err?.status === 429) throw new AIError('Anthropic rate limit reached. Try again shortly.', 429);
    throw new AIError(`Could not reach Anthropic: ${err.message}`);
  }
}

module.exports = { complete, isConfigured, AIError, AIUnavailableError, MODEL };

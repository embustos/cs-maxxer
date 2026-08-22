// The one place this app sends mail.
//
// Extracted from jobs/digest.js when password reset needed a sender too: two copies of
// the Resend call is two places for the `from:` address to drift, and `from:` is the
// field that decides whether the mail lands in an inbox or a spam folder.
const config = require('./config');

// Under `node --test` nothing goes out over the wire. The .env on a dev machine holds a
// live Resend key, and a test suite that mails example.com addresses is a test suite that
// burns the sending domain's reputation. Tests read `sent` instead.
const sent = [];
const underTest = () => Boolean(process.env.NODE_TEST_CONTEXT);

async function send({ to, subject, text }) {
  if (underTest()) {
    sent.push({ to, subject, text });
    return;
  }
  if (!config.resendApiKey) throw new Error('RESEND_API_KEY not set');
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    signal: AbortSignal.timeout(10000),
    headers: { authorization: `Bearer ${config.resendApiKey}`, 'content-type': 'application/json' },
    body: JSON.stringify({ from: config.mailFrom, to, subject, text }),
  });
  if (!res.ok) throw new Error(`Resend returned ${res.status}: ${await res.text()}`);
}

const link = (path, token) => `${config.appUrl}/?${path}=${token}`;

module.exports = { send, link, sent };

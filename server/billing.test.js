// The webhook is the only place money turns into credits, so its three properties get
// direct tests: forged requests bounce, real ones credit, retries credit only once.
//
// Env is set BEFORE config is required (config reads process.env exactly once). The
// values are fake — signature verification is pure HMAC, no network involved — and the
// key is assembled at runtime so secret scanners (rightly) don't match a key-shaped
// literal in source.
process.env.STRIPE_SECRET_KEY = ['sk', 'test', 'not-a-real-key'].join('_');
process.env.STRIPE_WEBHOOK_SECRET = 'whsec-fake-for-tests';
process.env.STRIPE_PRICE_ID = 'price_test_only';

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const Stripe = require('stripe');
const app = require('./index');
const db = require('./db');
const config = require('./config');

const uid = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
const email = `billing-${uid()}@example.com`;
let server, base, userId;

// Build a signed webhook payload the same way Stripe would.
const signedPost = (payload, secret = config.stripeWebhookSecret) => {
  const body = JSON.stringify(payload);
  const signature = Stripe.webhooks.generateTestHeaderString({ payload: body, secret });
  return fetch(`${base}/api/billing/webhook`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'stripe-signature': signature },
    body,
  });
};

const completedEvent = (id, userRef) => ({
  id,
  type: 'checkout.session.completed',
  data: { object: { client_reference_id: userRef } },
});

before(async () => {
  server = app.listen(0);
  base = `http://localhost:${server.address().port}`;
  const { rows } = await db.query(
    "insert into users (email, password_hash, username) values ($1, 'x', $2) returning id",
    [email, `b${Math.random().toString(36).slice(2, 10)}`],
  );
  userId = rows[0].id;
});

after(async () => {
  await db.query('delete from users where id = $1', [userId]);
  await db.query("delete from stripe_events where id like 'evt_test_%'");
  server.close();
  await db.end();
});

const credits = async () =>
  (await db.query('select ai_credits from users where id = $1', [userId])).rows[0].ai_credits;

test('an unsigned or forged webhook is rejected and credits nothing', async () => {
  const evt = completedEvent(`evt_test_forged_${uid()}`, String(userId));

  const unsigned = await fetch(`${base}/api/billing/webhook`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(evt),
  });
  assert.strictEqual(unsigned.status, 400);

  // Signed, but with the WRONG secret — what an attacker who read the payload format
  // but not the secret would produce.
  const forged = await signedPost(evt, 'whsec_attacker_guess');
  assert.strictEqual(forged.status, 400);

  assert.strictEqual(await credits(), 0, 'no free money');
});

test('a real completed checkout credits once — and its retry credits nothing', async () => {
  const evt = completedEvent(`evt_test_real_${uid()}`, String(userId));

  const first = await signedPost(evt);
  assert.strictEqual(first.status, 200);
  assert.strictEqual(await credits(), config.aiCreditsPerPurchase);

  // Stripe retries any webhook it isn't sure was received. Same event id, byte-identical
  // payload, valid signature — everything checks out except that it already happened.
  const retry = await signedPost(evt);
  assert.strictEqual(retry.status, 200, 'retries are acked, not errored, or Stripe keeps retrying');
  assert.strictEqual(await credits(), config.aiCreditsPerPurchase, 'double-credit is money from nothing');
});

test('unhandled event types are acknowledged without effect', async () => {
  const res = await signedPost({ id: `evt_test_other_${uid()}`, type: 'invoice.paid', data: { object: {} } });
  assert.strictEqual(res.status, 200);
  assert.strictEqual(await credits(), config.aiCreditsPerPurchase, 'unchanged');
});

// Selling AI review credit packs through Stripe Checkout.
//
// The division of labor: WE never see a card number — the user pays on Stripe's page.
// Stripe never decides who gets credits — the webhook does, after verifying that the
// event really came from Stripe. The price (amount, currency) lives in the Stripe
// dashboard as a Price object; this code only knows its id.
const express = require('express');
const Stripe = require('stripe');
const db = require('../db');
const config = require('../config');
const requireAuth = require('../middleware/auth');
const { log } = require('../middleware/logger');

const router = express.Router();

const configured = () =>
  Boolean(config.stripeSecretKey && config.stripePriceId && config.stripeWebhookSecret);

// Lazy, same pattern as ai.js: the server must boot fine without Stripe — the feature
// is optional, so its absence must not be a startup failure.
let stripe = null;
const getStripe = () => (stripe ??= new Stripe(config.stripeSecretKey));

router.post('/checkout', requireAuth, async (req, res) => {
  if (!configured()) {
    return res.status(503).json({ error: 'purchases are not set up yet' });
  }
  const session = await getStripe().checkout.sessions.create({
    mode: 'payment', // one-time pack, not a subscription — see docs/17
    line_items: [{ price: config.stripePriceId, quantity: 1 }],
    // The bridge back to our user. client_reference_id survives into the webhook event,
    // and it comes from the verified JWT — never from the request body, or anyone could
    // buy credits into someone else's account (or worse, claim someone else's payment).
    client_reference_id: String(req.user.id),
    success_url: `${config.appUrl}/?purchase=success`,
    cancel_url: `${config.appUrl}/?purchase=cancelled`,
  });
  res.json({ url: session.url });
});

// The webhook. Mounted with express.raw() in index.js — signature verification hashes
// the exact bytes Stripe sent, and the JSON parser would have already consumed and
// re-serialized them.
//
// No requireAuth: Stripe is the caller, and the signature IS the authentication. An
// unsigned or badly-signed request is discarded before its body is even parsed.
router.post('/webhook', async (req, res) => {
  if (!configured()) return res.status(503).end();

  let event;
  try {
    event = getStripe().webhooks.constructEvent(
      req.body,
      req.headers['stripe-signature'],
      config.stripeWebhookSecret,
    );
  } catch {
    // Not our event. 400 tells Stripe to retry a transient signature problem; a forged
    // request just gets nothing.
    return res.status(400).json({ error: 'bad signature' });
  }

  if (event.type === 'checkout.session.completed') {
    // Stripe retries until acknowledged, and a retry that re-credits is money invented
    // from nothing. The event id is recorded first; losing the insert race (or a
    // replay) means someone else already credited this exact payment — ack and stop.
    const { rowCount } = await db.query(
      'insert into stripe_events (id) values ($1) on conflict do nothing',
      [event.id],
    );
    if (rowCount === 1) {
      const userId = Number(event.data.object.client_reference_id);
      if (Number.isInteger(userId)) {
        await db.query('update users set ai_credits = ai_credits + $1 where id = $2', [
          config.aiCreditsPerPurchase,
          userId,
        ]);
        log({ level: 'info', msg: 'credits purchased', user_id: userId, credits: config.aiCreditsPerPurchase, event: event.id });
      } else {
        // A completed payment we can't attribute deserves a loud log, not a silent ack —
        // someone paid and got nothing.
        log({ level: 'error', msg: 'paid session without a user id', event: event.id });
      }
    }
  }

  // 200 for every verified event, including types we don't handle — "received" is all
  // Stripe wants to hear, and anything else makes it retry forever.
  res.json({ received: true });
});

module.exports = router;

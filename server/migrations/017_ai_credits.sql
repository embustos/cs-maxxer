-- Purchased AI reviews. The free monthly allowance lives in ai_calls/ai_period
-- (migration 013); credits are bought through Stripe Checkout, never expire, and are
-- consumed only after the free allowance runs out (middleware/aiQuota.js).
alter table users add column if not exists ai_credits integer not null default 0;

-- Stripe retries webhooks until acknowledged, and a retry that re-credits is real money
-- created from nothing. Recording every processed event id makes crediting idempotent:
-- the insert either wins (credit) or conflicts (skip).
create table if not exists stripe_events (
  id          text primary key,
  received_at timestamptz not null default now()
);

const { test } = require('node:test');
const assert = require('node:assert');
const { shouldSendToday, render } = require('./jobs/digest');

const MON = new Date('2026-08-24T12:00:00');
const WED = new Date('2026-08-26T12:00:00');

test("'off' never sends, on any day", () => {
  // The survey asked and they said no. Sending anyway breaks that promise and is the
  // fastest route to a spam complaint.
  assert.strictEqual(shouldSendToday('off', MON), false);
  assert.strictEqual(shouldSendToday('off', WED), false);
});

test("'weekly' sends on Monday only", () => {
  assert.strictEqual(shouldSendToday('weekly', MON), true);
  assert.strictEqual(shouldSendToday('weekly', WED), false);
});

test("'daily' and legacy nulls send every day", () => {
  assert.strictEqual(shouldSendToday('daily', WED), true);
  // Accounts created before the survey existed have no cadence — default to sending
  // rather than silently never contacting them.
  assert.strictEqual(shouldSendToday(null, WED), true);
});

test('the digest leads with one instruction, not a wall of lists', () => {
  const body = render({
    pending: [{ title: 'LeetCode daily' }, { title: 'Commit to a side project' }],
    upcoming: [{ title: 'ACM meeting', starts_at: '2026-08-25T18:00:00Z' }],
    stale: [{ company: 'Stripe', role: 'SWE Intern' }],
  });
  assert.match(body.split('\n')[0], /^Start here: LeetCode daily\./);
});

test('nothing to report produces no email at all', () => {
  // An app that mails "nothing to report" every morning gets muted within a week, and
  // then the one that mattered is missed too.
  assert.strictEqual(render({ pending: [], upcoming: [], stale: [] }), '');
});

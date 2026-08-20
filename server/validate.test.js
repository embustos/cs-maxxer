// Validation is a trust boundary — the tests that matter are the REJECTIONS.
const { test } = require('node:test');
const assert = require('node:assert');
const s = require('./schemas');

test('credentials normalize before validating', () => {
  const out = s.credentials.parse({ email: '  Me@School.EDU ', password: 'password123' });
  assert.strictEqual(out.email, 'me@school.edu');
});

test('credentials reject bad input', () => {
  for (const body of [
    { email: 'not-an-email', password: 'password123' },
    { email: 'a@b.com', password: 'short' },
    { email: '', password: 'password123' },
    {},
  ]) {
    assert.ok(!s.credentials.safeParse(body).success, `should reject ${JSON.stringify(body)}`);
  }
});

test('create fills defaults, update does not', () => {
  // This is the bug that motivated the split: a PATCH sending only {title} must not
  // silently reset cadence to 'daily'.
  assert.deepStrictEqual(s.habitCreate.parse({ title: 'x' }), {
    title: 'x', cadence: 'daily', target_per_week: 7,
  });
  assert.deepStrictEqual(s.habitUpdate.parse({ title: 'x' }), { title: 'x' });
});

test('enums reject anything not on the list', () => {
  assert.ok(!s.habitCreate.safeParse({ title: 'x', cadence: 'hourly' }).success);
  assert.ok(!s.applicationCreate.safeParse({ company: 'a', role: 'b', stage: 'maybe' }).success);
  assert.ok(!s.eventCreate.safeParse({ title: 'x', kind: 'party', starts_at: '2026-01-01T00:00:00Z' }).success);
});

test('numbers are coerced from strings but still bounded', () => {
  assert.strictEqual(s.goalCreate.parse({ title: 'g', target: '50' }).target, 50);
  assert.ok(!s.goalCreate.safeParse({ title: 'g', target: 0 }).success);
  assert.ok(!s.goalCreate.safeParse({ title: 'g', target: -5 }).success);
  assert.ok(!s.habitCreate.safeParse({ title: 'x', target_per_week: 1.5 }).success);
});

test('github usernames reject path traversal and injection attempts', () => {
  for (const bad of ['../../etc/passwd', 'a b', "'; drop table users;--", 'x'.repeat(40), '']) {
    assert.ok(!s.githubUsername.safeParse(bad).success, `should reject ${bad}`);
  }
  assert.ok(s.githubUsername.safeParse('torvalds').success);
});

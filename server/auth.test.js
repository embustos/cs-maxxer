const { test } = require('node:test');
const assert = require('node:assert');
const jwt = require('jsonwebtoken');

process.env.JWT_SECRET = 'test-secret';
const requireAuth = require('./middleware/auth');

const run = (authorization) => {
  const req = { headers: authorization ? { authorization } : {} };
  const res = {
    code: null,
    body: null,
    status(c) { this.code = c; return this; },
    json(b) { this.body = b; return this; },
  };
  let passed = false;
  requireAuth(req, res, () => { passed = true; });
  return { req, res, passed };
};

test('valid token populates req.user', () => {
  const token = jwt.sign({ sub: 7, email: 'a@b.com' }, 'test-secret', { expiresIn: '1h' });
  const { req, passed } = run(`Bearer ${token}`);
  assert.ok(passed);
  assert.deepStrictEqual(req.user, { id: 7, email: 'a@b.com' });
});

test('rejects missing, malformed, wrong-secret and expired tokens', () => {
  const wrongSecret = jwt.sign({ sub: 7 }, 'not-the-secret');
  const expired = jwt.sign({ sub: 7 }, 'test-secret', { expiresIn: '-1s' });

  for (const header of [undefined, 'Bearer', 'Bearer garbage', `Bearer ${wrongSecret}`, `Bearer ${expired}`, wrongSecret]) {
    const { res, passed } = run(header);
    assert.ok(!passed, `should not pass: ${header}`);
    assert.strictEqual(res.code, 401);
  }
});

const jwt = require('jsonwebtoken');
const config = require('../config');

// Verifies the signature + expiry, then hands the route a trusted req.user.
// No DB read: everything we need is in the (signed) payload.
module.exports = function requireAuth(req, res, next) {
  const token = req.headers.authorization?.match(/^Bearer (\S+)$/)?.[1];
  if (!token) return res.status(401).json({ error: 'missing token' });

  try {
    const { sub, email } = jwt.verify(token, config.jwtSecret);
    req.user = { id: sub, email };
    next();
  } catch {
    // jwt.verify throws on bad signature, malformed token, and expiry alike
    res.status(401).json({ error: 'invalid or expired token' });
  }
};

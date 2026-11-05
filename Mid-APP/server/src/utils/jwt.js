const jwt = require('jsonwebtoken');
require('dotenv').config();

if (!process.env.JWT_SECRET) {
  if (process.env.NODE_ENV === 'production') {
    // Refuse to run with a publicly-known default secret in production -
    // anyone could forge a valid admin token with it.
    throw new Error('JWT_SECRET must be set in production. Refusing to start.');
  }
  console.warn('JWT_SECRET is not set - using an insecure development-only default. Set JWT_SECRET in .env before deploying.');
}
const SECRET = process.env.JWT_SECRET || 'change-this-secret';
const EXPIRES_IN = process.env.JWT_EXPIRES_IN || '8h';

function signToken(payload) {
  return jwt.sign(payload, SECRET, { expiresIn: EXPIRES_IN });
}

function verifyToken(token) {
  return jwt.verify(token, SECRET);
}

module.exports = { signToken, verifyToken };

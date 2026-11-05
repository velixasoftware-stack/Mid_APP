const rateLimit = require('express-rate-limit');

// Generous enough to absorb normal mistyped-password retries, tight enough
// to blunt automated brute-force password guessing against login endpoints.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Too many login attempts. Please wait a few minutes and try again.' },
});

// The login screen looks up a client's locations as the Client Code is typed.
const locationLookupLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Too many requests. Please wait a few minutes and try again.' },
});

// Self-registration is public and creates a new client - keep it tight to
// deter signup spam/flooding.
const signupLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Too many signup attempts from this network. Please try again later.' },
});

// The public report link from a report's QR code - generous for real
// patients and front desks, but slows down anyone trying to guess links.
const publicReportLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Too many requests. Please wait a few minutes and try again.' },
});

module.exports = { locationLookupLimiter, loginLimiter, signupLimiter, publicReportLimiter };

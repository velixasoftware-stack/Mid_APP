const { Client } = require('../models');
const { syncClientPaymentStatus } = require('../controllers/subscription.controller');

/**
 * Core business rule: a client user may authenticate successfully, but every
 * protected screen/API must stay blocked while the client's subscription is
 * PENDING or EXPIRED — including when the chosen Start Date/End Date window
 * for the last paid cycle has simply run out. Must run server-side (not just
 * hidden in the UI), so this re-derives the status from the subscription
 * dates on every request rather than trusting a possibly-stale flag.
 */
async function requireActiveSubscription(req, res, next) {
  if (req.user?.type !== 'CLIENT_USER') {
    return res.status(403).json({ message: 'Client user access required' });
  }

  const client = await Client.findByPk(req.user.clientId);
  if (!client || !client.active) {
    return res.status(403).json({ message: 'Client account is inactive' });
  }

  const paymentStatus = await syncClientPaymentStatus(client.id);
  if (paymentStatus !== 'PAID') {
    return res.status(402).json({
      message: 'Monthly subscription payment is pending. Access is blocked until payment is confirmed.',
      paymentStatus,
    });
  }

  return next();
}

module.exports = { requireActiveSubscription };

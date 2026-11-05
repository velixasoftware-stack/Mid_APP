const { ClientPayment, ClientSubscription, Client } = require('../models');
const { createOrder, verifyPaymentSignature, verifyWebhookSignature, isMock } = require('../utils/razorpay');
const { getOrCreateCurrentSubscription, getOrCreatePayableSubscription, createAdvanceCycles, getPaidThroughDate, syncClientPaymentStatus } = require('./subscription.controller');

const MANUAL_PAYMENT_MODES = ['Cash', 'Bank Transfer', 'UPI', 'Cheque', 'Other'];

const MAX_ADVANCE_MONTHS = 24;

/** Marks a subscription + payment + client as PAID, extending extra advance cycles if paid for. Idempotent. */
async function markPaid({ payment, subscription, gatewayResponse, transactionId, paymentMode }) {
  const alreadyPaid = payment.status === 'PAID';

  if (!alreadyPaid) {
    await payment.update({
      status: 'PAID',
      transactionId: transactionId || payment.transactionId,
      paymentMode: paymentMode || 'RAZORPAY',
      paymentDate: new Date(),
      gatewayResponse: gatewayResponse || payment.gatewayResponse,
    });

    // A due cycle's dates are fixed at the time it was scheduled, so paying
    // it on time or late both used to just settle whatever was left of that
    // pre-set range - e.g. paying on the 16th for a cycle that already ends
    // on the 30th only bought 14 days. Once payment actually happens on or
    // after the cycle's start, it should instead run a full month from today
    // (the actual payment date), so "pay for 1 month" always means a month
    // from now. Paying genuinely in advance, before the cycle even starts,
    // is left untouched so advance cycles stay on their scheduled dates.
    const today = new Date();
    if (today >= new Date(subscription.fromDate)) {
      const newToDate = new Date(today);
      newToDate.setMonth(newToDate.getMonth() + 1);
      await subscription.update({ fromDate: today, toDate: newToDate, dueDate: newToDate });
    }
  }
  if (subscription.status !== 'PAID') {
    await subscription.update({ status: 'PAID' });
  }
  if (!alreadyPaid && payment.monthsCovered > 1) {
    await createAdvanceCycles(subscription, payment.monthsCovered - 1);
  }
  await Client.update({ paymentStatus: 'PAID' }, { where: { id: subscription.clientId } });
}

// POST /api/payments/create-order  (authenticated client user)
// Body: { months?: number } -- pay the due cycle, or (even if already paid) top up / pay in advance.
async function createPaymentOrder(req, res) {
  const { clientId } = req.user;
  const subscription = await getOrCreatePayableSubscription(clientId);

  const monthsCovered = Math.max(1, Math.min(MAX_ADVANCE_MONTHS, Number(req.body.months) || 1));
  const totalAmount = Number(subscription.amount) * monthsCovered;

  const order = await createOrder({
    amount: totalAmount,
    receipt: `sub_${subscription.id}_x${monthsCovered}`,
    notes: { clientId: String(clientId), subscriptionId: String(subscription.id), monthsCovered: String(monthsCovered) },
  });

  const payment = await ClientPayment.create({
    clientId,
    subscriptionId: subscription.id,
    orderId: order.id,
    amount: totalAmount,
    monthsCovered,
    status: 'CREATED',
  });

  return res.status(201).json({
    paymentId: payment.id,
    orderId: order.id,
    amount: order.amount,
    currency: order.currency || 'INR',
    mock: isMock,
    keyId: process.env.RAZORPAY_KEY_ID || null,
    subscriptionMonth: subscription.month,
    monthsCovered,
    monthlyAmount: subscription.amount,
  });
}

// POST /api/clients/:clientId/manual-payment  (Chief Admin only)
// For a client that paid Chief Admin directly (cash, bank transfer, etc.)
// outside the app instead of through the in-app QR/Razorpay checkout.
// Reuses the exact same markPaid() the Razorpay flow uses, so this updates
// the client's paymentStatus and the covered subscription cycle(s) in one
// place - both Chief Admin's own dashboard and the client's own login/home
// screen read from that same data, so both reflect it immediately, with no
// separate sync step.
async function recordManualPayment(req, res) {
  const { clientId } = req.params;
  const { months, mode, transactionId, remarks } = req.body;

  const client = await Client.findByPk(clientId);
  if (!client) return res.status(404).json({ message: 'Client not found' });
  if (!mode || !MANUAL_PAYMENT_MODES.includes(mode)) {
    return res.status(400).json({ message: `mode must be one of ${MANUAL_PAYMENT_MODES.join(', ')}` });
  }

  const monthsCovered = Math.max(1, Math.min(MAX_ADVANCE_MONTHS, Number(months) || 1));
  const subscription = await getOrCreatePayableSubscription(clientId);
  const totalAmount = Number(subscription.amount) * monthsCovered;

  const payment = await ClientPayment.create({
    clientId,
    subscriptionId: subscription.id,
    amount: totalAmount,
    monthsCovered,
    status: 'CREATED',
  });

  await markPaid({
    payment,
    subscription,
    transactionId: transactionId || undefined,
    paymentMode: mode,
    gatewayResponse: { manualEntry: true, remarks: remarks || null },
  });

  const paidThrough = await getPaidThroughDate(clientId);
  return res.status(201).json({ message: 'Payment recorded - client access enabled.', monthsCovered, paidThrough });
}

// POST /api/payments/verify  (frontend callback after Razorpay checkout closes)
// Body: { orderId, paymentId, signature }  -- or, in MOCK mode, just { orderId }
async function verifyPayment(req, res) {
  const { orderId, paymentId, signature } = req.body;
  if (!orderId) return res.status(400).json({ message: 'orderId is required' });

  const payment = await ClientPayment.findOne({ where: { orderId } });
  if (!payment) return res.status(404).json({ message: 'Payment order not found' });

  const validSignature = verifyPaymentSignature({ orderId, paymentId, signature });
  if (!validSignature) return res.status(400).json({ message: 'Payment signature verification failed' });

  const subscription = await ClientSubscription.findByPk(payment.subscriptionId);
  await markPaid({
    payment,
    subscription,
    transactionId: paymentId,
    gatewayResponse: { orderId, paymentId, signature, verifiedVia: 'frontend-callback' },
  });

  const paidThrough = await getPaidThroughDate(payment.clientId);
  return res.json({ message: 'Payment verified. Access enabled.', status: 'PAID', monthsCovered: payment.monthsCovered, paidThrough });
}

// POST /api/payments/webhook  (server-to-server callback from Razorpay - source of truth)
async function razorpayWebhook(req, res) {
  const signature = req.headers['x-razorpay-signature'];
  const rawBody = req.rawBody || JSON.stringify(req.body);

  if (!verifyWebhookSignature(rawBody, signature)) {
    return res.status(400).json({ message: 'Invalid webhook signature' });
  }

  const event = req.body;
  const orderId = event?.payload?.payment?.entity?.order_id || event?.orderId;
  const paymentEntityId = event?.payload?.payment?.entity?.id || event?.paymentId;
  const eventType = event?.event || 'payment.captured';

  if (!orderId) return res.status(400).json({ message: 'orderId missing in webhook payload' });
  if (!['payment.captured', 'order.paid'].includes(eventType) && eventType !== 'payment.captured') {
    return res.status(200).json({ message: 'Event ignored' });
  }

  const payment = await ClientPayment.findOne({ where: { orderId } });
  if (!payment) return res.status(404).json({ message: 'Payment order not found' });

  const subscription = await ClientSubscription.findByPk(payment.subscriptionId);
  await markPaid({
    payment,
    subscription,
    transactionId: paymentEntityId,
    gatewayResponse: event,
  });

  return res.status(200).json({ message: 'Webhook processed' });
}

// GET /api/payments/status  (frontend polling fallback, and feeds the Home page expiry countdown)
async function paymentStatus(req, res) {
  const { clientId } = req.user;
  const subscription = await getOrCreateCurrentSubscription(clientId);
  // toDate is just the cycle covering today, which doesn't move when paying
  // further in advance (the new cycles are chained on after it, not into
  // it) - paidThrough is the true furthest-paid date, so an advance payment
  // visibly extends what the client sees here, not just the Chief Admin side.
  const paidThrough = await getPaidThroughDate(clientId);
  // Same value requireActiveSubscription gates on - the client re-checks this
  // on every page load so a refresh can't drop the payment-pending block.
  const clientPaymentStatus = await syncClientPaymentStatus(clientId);
  return res.json({
    clientPaymentStatus,
    status: subscription.status,
    month: subscription.month,
    toDate: subscription.toDate,
    dueDate: subscription.dueDate,
    paidThrough,
  });
}

module.exports = {
  createPaymentOrder, verifyPayment, razorpayWebhook, paymentStatus, recordManualPayment, MANUAL_PAYMENT_MODES,
};

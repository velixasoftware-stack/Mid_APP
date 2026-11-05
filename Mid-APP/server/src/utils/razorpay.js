const crypto = require('crypto');
require('dotenv').config();

const KEY_ID = process.env.RAZORPAY_KEY_ID;
const KEY_SECRET = process.env.RAZORPAY_KEY_SECRET;
const WEBHOOK_SECRET = process.env.RAZORPAY_WEBHOOK_SECRET;

const isMock = !KEY_ID || !KEY_SECRET;

let razorpayInstance = null;
if (!isMock) {
  const Razorpay = require('razorpay');
  razorpayInstance = new Razorpay({ key_id: KEY_ID, key_secret: KEY_SECRET });
}

/**
 * Creates a payment order. Falls back to a mock order (no real gateway call)
 * when RAZORPAY_KEY_ID/SECRET are not configured, so the full subscription/
 * payment flow can be exercised end-to-end without live credentials.
 */
async function createOrder({ amount, receipt, notes }) {
  if (isMock) {
    return {
      id: `mock_order_${crypto.randomBytes(8).toString('hex')}`,
      amount: Math.round(amount * 100),
      currency: 'INR',
      receipt,
      status: 'created',
      mock: true,
    };
  }
  return razorpayInstance.orders.create({
    amount: Math.round(amount * 100),
    currency: 'INR',
    receipt,
    notes,
  });
}

/** Verifies the checkout handler signature returned to the frontend after payment. */
function verifyPaymentSignature({ orderId, paymentId, signature }) {
  if (isMock) return true;
  const expected = crypto
    .createHmac('sha256', KEY_SECRET)
    .update(`${orderId}|${paymentId}`)
    .digest('hex');
  return expected === signature;
}

/** Verifies the X-Razorpay-Signature header on incoming webhook calls. */
function verifyWebhookSignature(rawBody, signature) {
  if (isMock) return true;
  if (!WEBHOOK_SECRET) return false;
  const expected = crypto
    .createHmac('sha256', WEBHOOK_SECRET)
    .update(rawBody)
    .digest('hex');
  return expected === signature;
}

module.exports = { isMock, createOrder, verifyPaymentSignature, verifyWebhookSignature };

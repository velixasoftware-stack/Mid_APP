const router = require('express').Router();
const { authenticate } = require('../middleware/auth.middleware');
const paymentCtrl = require('../controllers/payment.controller');

// Public: called by Razorpay servers, authenticated via signature, not JWT.
router.post('/webhook', paymentCtrl.razorpayWebhook);

// Authenticated client-user routes (deliberately NOT behind requireActiveSubscription,
// since these are exactly how a PENDING/EXPIRED client regains access).
router.post('/create-order', authenticate, paymentCtrl.createPaymentOrder);
router.post('/verify', authenticate, paymentCtrl.verifyPayment);
router.get('/status', authenticate, paymentCtrl.paymentStatus);

module.exports = router;

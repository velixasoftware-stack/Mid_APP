const router = require('express').Router();
const { authenticate } = require('../middleware/auth.middleware');
const { requireRole } = require('../middleware/role.middleware');
const { requireActiveSubscription } = require('../middleware/subscription.middleware');
const { ROLES } = require('../utils/roles');
const billingCtrl = require('../controllers/billing.controller');

router.use(authenticate, requireActiveSubscription);

// Bill creation itself stays Front-Office-only - that's FrontDesk.jsx's job.
// The test-price list is also needed by Manager from the Edit Order screen
// (adding a test to an already-billed order), so it isn't Front-Office-only.
router.get('/test-prices', requireRole(ROLES.FRONT_OFFICE, ROLES.MANAGER), billingCtrl.listTestPrices);
router.get('/packages', requireRole(ROLES.FRONT_OFFICE), billingCtrl.listPackages);
router.get('/payors', requireRole(ROLES.FRONT_OFFICE), billingCtrl.listPayors);
router.get('/payors/:id/test-prices', requireRole(ROLES.FRONT_OFFICE), billingCtrl.listPayorTestPrices);
router.post('/bills', requireRole(ROLES.FRONT_OFFICE), billingCtrl.createBill);

// The Orders screen itself (list, print/receipt view, cancel & refund) is
// also usable by Manager, so they can reach the same screen to configure
// and use cancellation/refund without needing Front Office to do it for them.
router.get('/bills', requireRole(ROLES.FRONT_OFFICE, ROLES.MANAGER), billingCtrl.listBills);
router.get('/bills/:id', requireRole(ROLES.FRONT_OFFICE, ROLES.MANAGER), billingCtrl.getBill);
router.put('/bills/:billId/items/:itemId/cancel', requireRole(ROLES.FRONT_OFFICE, ROLES.MANAGER), billingCtrl.cancelBillItem);
router.post('/bills/:billId/items', requireRole(ROLES.FRONT_OFFICE, ROLES.MANAGER), billingCtrl.addBillItem);
router.put('/bills/:billId/discount', requireRole(ROLES.FRONT_OFFICE, ROLES.MANAGER), billingCtrl.applyPostBillingDiscount);
router.put('/bills/:billId/discounts/:discountId/cancel', requireRole(ROLES.FRONT_OFFICE, ROLES.MANAGER), billingCtrl.cancelPostBillingDiscount);
router.post('/bills/:billId/due-payments', requireRole(ROLES.FRONT_OFFICE, ROLES.MANAGER), billingCtrl.recordDuePayment);
router.post('/bills/:billId/share', requireRole(ROLES.FRONT_OFFICE, ROLES.MANAGER), billingCtrl.shareBill);

module.exports = router;

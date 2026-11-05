const router = require('express').Router();
const { authenticate } = require('../middleware/auth.middleware');
const { requireRole } = require('../middleware/role.middleware');
const { requireActiveSubscription } = require('../middleware/subscription.middleware');
const { ROLES } = require('../utils/roles');
const reportCtrl = require('../controllers/report.controller');

router.use(authenticate, requireActiveSubscription, requireRole(ROLES.MANAGER));

router.get('/transactions', reportCtrl.transactions);
router.get('/collection-summary', reportCtrl.collectionSummary);
router.get('/outstanding', reportCtrl.outstanding);
router.get('/lab-summary', reportCtrl.labSummary);
router.get('/lab-details', reportCtrl.labDetails);
router.get('/test-wise-revenue', reportCtrl.testWiseRevenue);
router.get('/report-status', reportCtrl.reportStatusCounts);
router.get('/payment-breakdown', reportCtrl.paymentBreakdown);
router.get('/export', reportCtrl.exportReport);

module.exports = router;

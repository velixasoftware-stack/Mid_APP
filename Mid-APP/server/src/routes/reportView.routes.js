const router = require('express').Router();
const { authenticate } = require('../middleware/auth.middleware');
const { requireRole } = require('../middleware/role.middleware');
const { requireActiveSubscription } = require('../middleware/subscription.middleware');
const { ROLES } = require('../utils/roles');
const labCtrl = require('../controllers/lab.controller');

// The consolidated per-bill lab report is viewable by whichever roles need to
// hand it to a patient or file it - not just the Lab User who released it.
router.use(authenticate, requireActiveSubscription, requireRole(ROLES.FRONT_OFFICE, ROLES.LAB_USER, ROLES.MANAGER));

router.get('/bills/:billId/report', labCtrl.getBillReport);
router.get('/bills/:billId/trend', labCtrl.getBillTrendReport);
router.post('/bills/:billId/report/share', labCtrl.shareReport);
// Pending Lab Tests worklist (and its Excel export) - same audience as the report.
router.get('/pending-tests', labCtrl.getPendingTests);

module.exports = router;

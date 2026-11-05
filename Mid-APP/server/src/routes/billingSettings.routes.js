const router = require('express').Router();
const { authenticate } = require('../middleware/auth.middleware');
const { requireRole } = require('../middleware/role.middleware');
const { requireActiveSubscription } = require('../middleware/subscription.middleware');
const { ROLES } = require('../utils/roles');
const ctrl = require('../controllers/billing.controller');

router.use(authenticate, requireActiveSubscription);

// Any client-side role can read it (Front Office needs it too, to know
// whether to show its own Cancel/Refund button).
router.get('/', ctrl.getBillingSettings);

// Only the clinic's own Admin/Manager can change it - no Chief Admin needed.
// (requireRole always lets ADMIN through regardless of the role listed here.)
router.put('/', requireRole(ROLES.MANAGER), ctrl.updateBillingSettings);

module.exports = router;

const router = require('express').Router();
const { authenticate } = require('../middleware/auth.middleware');
const { requireRole } = require('../middleware/role.middleware');
const { requireActiveSubscription } = require('../middleware/subscription.middleware');
const ctrl = require('../controllers/roleScreen.controller');

// Every logged-in client user needs this to build their own nav - no role
// restriction (and no active-subscription gate, so the shell still renders
// sensibly even while a payment is pending).
router.get('/effective', authenticate, ctrl.getEffectiveRoleScreens);

// Only the client's own ADMIN can view/change the override for their staff.
router.get('/', authenticate, requireActiveSubscription, requireRole(), ctrl.getClientRoleScreens);
router.put('/', authenticate, requireActiveSubscription, requireRole(), ctrl.updateClientRoleScreens);

module.exports = router;

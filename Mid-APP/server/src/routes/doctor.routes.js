const router = require('express').Router();
const { authenticate } = require('../middleware/auth.middleware');
const { requireRole } = require('../middleware/role.middleware');
const { requireActiveSubscription } = require('../middleware/subscription.middleware');
const { ROLES } = require('../utils/roles');
const ctrl = require('../controllers/referralDoctor.controller');

router.use(authenticate, requireActiveSubscription, requireRole(ROLES.FRONT_OFFICE));

router.get('/', ctrl.listDoctors);

module.exports = router;

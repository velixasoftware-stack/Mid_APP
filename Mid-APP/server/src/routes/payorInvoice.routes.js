const router = require('express').Router();
const { authenticate } = require('../middleware/auth.middleware');
const { requireRole } = require('../middleware/role.middleware');
const { requireActiveSubscription } = require('../middleware/subscription.middleware');
const { ROLES } = require('../utils/roles');
const ctrl = require('../controllers/payorInvoice.controller');

router.use(authenticate, requireActiveSubscription, requireRole(ROLES.MANAGER));

router.get('/payors', ctrl.listPayors);
router.get('/pending', ctrl.listPendingBills);
router.post('/generate', ctrl.generateInvoice);
router.get('/', ctrl.listInvoices);
router.get('/:id', ctrl.getInvoice);
router.post('/:id/collections', ctrl.addCollection);

module.exports = router;

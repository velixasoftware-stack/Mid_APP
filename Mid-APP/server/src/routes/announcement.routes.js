const router = require('express').Router();
const { authenticate, requireChiefAdminRole } = require('../middleware/auth.middleware');
const { CHIEF_ADMIN_ROLES } = require('../utils/roles');
const ctrl = require('../controllers/announcement.controller');

// Public: the client login page reads this before anyone has signed in.
router.get('/active', ctrl.listActive);

// Managing captions is Chief Admin (ADMIN role) only.
router.use(authenticate, requireChiefAdminRole(CHIEF_ADMIN_ROLES.ADMIN));
router.get('/', ctrl.list);
router.post('/', ctrl.create);
router.put('/:id', ctrl.update);
router.delete('/:id', ctrl.remove);

module.exports = router;

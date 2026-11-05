const router = require('express').Router();
const { authenticate, requireChiefAdminRole } = require('../middleware/auth.middleware');
const { CHIEF_ADMIN_ROLES } = require('../utils/roles');
const ctrl = require('../controllers/roleScreen.controller');

// The platform-wide baseline is Chief-Admin (ADMIN) territory only.
router.use(authenticate, requireChiefAdminRole(CHIEF_ADMIN_ROLES.ADMIN));

router.get('/', ctrl.getRoleScreenDefaults);
router.put('/', ctrl.updateRoleScreenDefault);

module.exports = router;

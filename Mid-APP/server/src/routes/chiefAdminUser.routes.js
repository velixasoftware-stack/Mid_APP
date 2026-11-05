const router = require('express').Router();
const { authenticate, requireChiefAdminRole } = require('../middleware/auth.middleware');
const { CHIEF_ADMIN_ROLES } = require('../utils/roles');
const ctrl = require('../controllers/chiefAdminUser.controller');
const salesReportCtrl = require('../controllers/salesReport.controller');

router.use(authenticate);

// Sales Dashboard: ADMIN sees everyone; a MARKETING user sees only their own
// clients, without the total monthly revenue figures (see salesReport.controller).
const salesAccess = requireChiefAdminRole(CHIEF_ADMIN_ROLES.ADMIN, CHIEF_ADMIN_ROLES.MARKETING);
router.get('/sales-report', salesAccess, salesReportCtrl.getSalesReport);
router.get('/sales-report/export', salesAccess, salesReportCtrl.exportSalesReport);

// Everything else that manages Chief-Admin-side staff accounts (creating them,
// editing roles/active status, the sales report) is ADMIN-only.
router.use(requireChiefAdminRole(CHIEF_ADMIN_ROLES.ADMIN));

// Team (listing, creating, editing and resetting passwords of Chief-Admin-side
// staff) is ADMIN only - not part of a MARKETING user's screens.
router.get('/', ctrl.listChiefAdminUsers);
router.put('/:id/reset-password', ctrl.resetPassword);
router.post('/', ctrl.createChiefAdminUser);
router.post('/bulk', ctrl.createChiefAdminUsersBulk);
router.put('/:id', ctrl.updateChiefAdminUser);


module.exports = router;

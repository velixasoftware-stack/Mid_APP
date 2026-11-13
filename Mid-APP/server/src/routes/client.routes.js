const router = require('express').Router();
const multer = require('multer');
const { authenticate, requireChiefAdmin, requireChiefAdminRole, isMarketingOnly } = require('../middleware/auth.middleware');
const { Client } = require('../models');
const { CHIEF_ADMIN_ROLES } = require('../utils/roles');
const clientCtrl = require('../controllers/client.controller');
const subCtrl = require('../controllers/subscription.controller');
const userCtrl = require('../controllers/user.controller');
const priceCtrl = require('../controllers/clientTestPrice.controller');
const roleScreenCtrl = require('../controllers/roleScreen.controller');
const paymentCtrl = require('../controllers/payment.controller');
const resetCtrl = require('../controllers/clientDataReset.controller');
const locationCtrl = require('../controllers/clientLocation.controller');

const upload = multer({ storage: multer.memoryStorage() });

// All routes here are Chief Admin only.
router.use(authenticate, requireChiefAdmin);

// Changing an existing client (details, users, prices, payments, access) is
// ADMIN only - a MARKETING user can look at their own clients but not edit them.
const requireAdminRole = requireChiefAdminRole(CHIEF_ADMIN_ROLES.ADMIN);

// A MARKETING-only user may only open clients assigned to them.
async function assignedClientOnly(req, res, next) {
  if (!isMarketingOnly(req)) return next();
  const client = await Client.findByPk(req.params.id || req.params.clientId, { attributes: ['id', 'salesPerson'] });
  if (!client) return res.status(404).json({ message: 'Client not found' });
  if ((client.salesPerson || '').toLowerCase() !== (req.user.username || '').toLowerCase()) {
    return res.status(403).json({ message: 'This client is not assigned to you' });
  }
  return next();
}

router.post('/', clientCtrl.createClient);
router.get('/', clientCtrl.listClients);
router.get('/marketing-persons', clientCtrl.listMarketingPersons);
router.get('/next-code', clientCtrl.previewNextClientCode);
router.get('/:id', assignedClientOnly, clientCtrl.getClient);
router.put('/:id', requireAdminRole, clientCtrl.updateClient);
// Opens this client's app as their auto-provisioned support login - ADMIN for
// any client; MARKETING only for clients assigned to them (assignedClientOnly).
router.post('/:id/impersonate', requireChiefAdminRole(CHIEF_ADMIN_ROLES.ADMIN, CHIEF_ADMIN_ROLES.MARKETING), assignedClientOnly, clientCtrl.impersonateClient);

router.get('/:clientId/subscriptions', assignedClientOnly, subCtrl.listSubscriptions);
// Correct one cycle's dates (backdating allowed) and amount - ADMIN only, money-touching.
router.put('/:clientId/subscriptions/:subscriptionId', requireAdminRole, subCtrl.updateSubscription);
router.get('/:clientId/subscriptions/current', assignedClientOnly, subCtrl.getCurrentSubscription);
// A client that paid Chief Admin directly (outside the app) - ADMIN only, money-touching like role-screens below.
router.post('/:clientId/manual-payment', requireChiefAdminRole(CHIEF_ADMIN_ROLES.ADMIN), paymentCtrl.recordManualPayment);
// This client's lab-billing revenue (money collected from their own patients) - ADMIN only, same as other financial data.
router.get('/:clientId/revenue', requireChiefAdminRole(CHIEF_ADMIN_ROLES.ADMIN), clientCtrl.getClientRevenue);
// A promotional free period for an existing client - ADMIN only, money-related like manual-payment above.
router.post('/:clientId/free-days', requireChiefAdminRole(CHIEF_ADMIN_ROLES.ADMIN), subCtrl.grantFreeDays);
// Client Data Reset - ADMIN only: see, back up and remove one client's data by area.
router.get('/:clientId/data-summary', requireAdminRole, resetCtrl.getDataSummary);
router.get('/:clientId/data-export', requireAdminRole, resetCtrl.exportClientData);
router.post('/:clientId/data-reset', requireAdminRole, resetCtrl.resetClientData);

router.get('/:clientId/locations', assignedClientOnly, locationCtrl.listLocations);
router.post('/:clientId/locations', requireAdminRole, locationCtrl.createLocation);
router.put('/:clientId/locations/:locationId', requireAdminRole, locationCtrl.updateLocation);

router.post('/:clientId/users', requireAdminRole, userCtrl.createUser);
router.get('/:clientId/users', assignedClientOnly, userCtrl.listUsers);
router.put('/:clientId/users/:userId', requireAdminRole, userCtrl.updateUser);
// Password-only reset: ADMIN, or MARKETING for their own assigned clients.
router.put('/:clientId/users/:userId/reset-password', requireChiefAdminRole(CHIEF_ADMIN_ROLES.ADMIN, CHIEF_ADMIN_ROLES.MARKETING), assignedClientOnly, userCtrl.resetUserPassword);
router.post('/:clientId/users/:userId/signature', requireAdminRole, upload.single('signature'), userCtrl.uploadSignature);

router.get('/:clientId/test-prices', assignedClientOnly, priceCtrl.listPrices);
router.put('/:clientId/test-prices', requireAdminRole, priceCtrl.setPrice);
router.post('/:clientId/test-prices/upload/preview', requireAdminRole, upload.single('file'), priceCtrl.previewUpload);
router.post('/:clientId/test-prices/upload/commit', requireAdminRole, priceCtrl.commitUpload);

// Role -> screen access for this one client's staff - Chief Admin (ADMIN role) only,
// not Marketing, matching /role-screen-defaults' restriction on the platform-wide baseline.
router.get('/:clientId/role-screens', requireAdminRole, roleScreenCtrl.getClientRoleScreensForAdmin);
router.put('/:clientId/role-screens', requireAdminRole, roleScreenCtrl.updateClientRoleScreensForAdmin);

module.exports = router;

const router = require('express').Router();
const multer = require('multer');
const { authenticate } = require('../middleware/auth.middleware');
const { requireRole } = require('../middleware/role.middleware');
const { requireActiveSubscription } = require('../middleware/subscription.middleware');
const { ROLES } = require('../utils/roles');
const testCtrl = require('../controllers/testMaster.controller');
const priceCtrl = require('../controllers/clientTestPrice.controller');
const packageCtrl = require('../controllers/package.controller');
const payorCtrl = require('../controllers/payor.controller');

const upload = multer({ storage: multer.memoryStorage() });

router.use(authenticate, requireActiveSubscription, requireRole(ROLES.MASTER_MANAGER));

// Test Master (global, unique across all clients)
router.get('/groups', testCtrl.listTestGroups); // Chief-Admin-created groups (read only here)
router.get('/tests', testCtrl.listTests);
router.post('/tests', testCtrl.createTest);
router.put('/tests/:id', testCtrl.updateTest);
router.post('/tests/:testId/parameters', testCtrl.addParameter);
router.post('/tests/:testId/parameters/:parameterId/assign', testCtrl.assignParameter);
router.put('/tests/:testId/parameter-order', testCtrl.reorderParameters);
router.put('/tests/:testId/parameters/:parameterId/sequence', testCtrl.setParameterSequence);
router.delete('/tests/:testId/parameters/:parameterId', testCtrl.removeParameter);
router.post('/parameters/:parameterId/ranges', testCtrl.addNormalRange);
router.delete('/parameters/:parameterId/ranges/:rangeId', testCtrl.deleteNormalRange);
router.put('/parameters/:parameterId/ranges/:rangeId', testCtrl.updateNormalRange); // edit one age/gender row
router.put('/parameters/:parameterId/ranges/:rangeId/text', testCtrl.updateNormalRange); // just its printed text
router.put('/parameters/:parameterId/normal-range-text', testCtrl.setNormalRangeText); // printed reference range
router.delete('/parameters/:parameterId/customization', testCtrl.resetParameterRanges); // back to Chief Admin's ranges

// Client-wise test pricing for the logged-in client
router.get('/client-test-price', priceCtrl.listPrices);
router.put('/client-test-price', priceCtrl.setPrice);
router.get('/client-test-price/template', priceCtrl.downloadTemplate);
router.post('/client-test-price/upload/preview', upload.single('file'), priceCtrl.previewUpload);
router.post('/client-test-price/upload/commit', priceCtrl.commitUpload);
router.put('/client-test-price/:testId/status', priceCtrl.setPriceStatus);

// Packages (client-wise bundles of tests with their own price)
router.get('/packages', packageCtrl.listPackages);
router.post('/packages', packageCtrl.createPackage);
router.put('/packages/:id', packageCtrl.updatePackage);
router.get('/packages/template', packageCtrl.downloadTemplate);
router.post('/packages/upload/preview', upload.single('file'), packageCtrl.previewUpload);
router.post('/packages/upload/commit', packageCtrl.commitUpload);

// Payors (third parties billed monthly - corporate/TPA/insurer) and their
// negotiated per-test prices
router.get('/payors', payorCtrl.listPayors);
router.post('/payors', payorCtrl.createPayor);
router.put('/payors/:id', payorCtrl.updatePayor);
router.get('/payors/:id/test-prices', payorCtrl.listPayorTestPrices);
router.put('/payors/:id/test-prices', payorCtrl.setPayorTestPrice);
router.get('/payors/:id/test-prices/template', payorCtrl.downloadPayorPriceTemplate);
router.post('/payors/:id/test-prices/upload/preview', upload.single('file'), payorCtrl.previewPayorPriceUpload);
router.post('/payors/:id/test-prices/upload/commit', payorCtrl.commitPayorPriceUpload);

module.exports = router;

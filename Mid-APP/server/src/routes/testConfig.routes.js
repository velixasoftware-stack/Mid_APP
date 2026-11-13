const router = require('express').Router();
const multer = require('multer');
const { authenticate } = require('../middleware/auth.middleware');
const { requireRole } = require('../middleware/role.middleware');
const { requireActiveSubscription } = require('../middleware/subscription.middleware');
const { ROLES } = require('../utils/roles');
const testCtrl = require('../controllers/testMaster.controller');
const shortNameCtrl = require('../controllers/clientTestShortName.controller');

const upload = multer({ storage: multer.memoryStorage() });

// Separate from master.routes.js (which stays MASTER_MANAGER-only) so a
// Manager can create their own client-private parameters and test short
// names without gaining access to Test Master creation, pricing or packages.
router.use(authenticate, requireActiveSubscription, requireRole(ROLES.MANAGER, ROLES.MASTER_MANAGER));

router.get('/tests', testCtrl.listTests);
router.put('/tests/:testId/specimen', testCtrl.setClientSpecimen); // this client's own specimen (not Chief Admin's)
router.post('/tests/:testId/parameters', testCtrl.addParameter);
router.post('/tests/:testId/parameters/:parameterId/assign', testCtrl.assignParameter);
router.put('/tests/:testId/parameter-order', testCtrl.reorderParameters);
router.put('/tests/:testId/parameters/:parameterId/sequence', testCtrl.setParameterSequence);
router.delete('/tests/:testId/parameters/:parameterId', testCtrl.removeParameter); // a universal one: hidden for this client only
router.post('/tests/:testId/parameters/:parameterId/restore', testCtrl.restoreHiddenParameter);
router.put('/parameters/:parameterId', testCtrl.updateParameterDetails); // name / unit / method (a clinic on a universal one: its own only)
router.post('/parameters/:parameterId/ranges', testCtrl.addNormalRange);
router.delete('/parameters/:parameterId/ranges/:rangeId', testCtrl.deleteNormalRange);
router.put('/parameters/:parameterId/ranges/:rangeId', testCtrl.updateNormalRange); // edit one age/gender row
router.put('/parameters/:parameterId/ranges/:rangeId/text', testCtrl.updateNormalRange); // just its printed text
router.put('/parameters/:parameterId/normal-range-text', testCtrl.setNormalRangeText); // printed reference range
router.delete('/parameters/:parameterId/customization', testCtrl.resetParameterRanges); // back to Chief Admin's ranges
router.put('/parameters/:parameterId/trend', testCtrl.setParameterTrend); // show this parameter's trend on reports

router.get('/test-shortname', shortNameCtrl.listShortNames);
router.put('/test-shortname', shortNameCtrl.setShortName);
router.get('/test-shortname/template', shortNameCtrl.downloadTemplate);
router.post('/test-shortname/upload/preview', upload.single('file'), shortNameCtrl.previewUpload);
router.post('/test-shortname/upload/commit', shortNameCtrl.commitUpload);

module.exports = router;

const router = require('express').Router();
const multer = require('multer');
const { authenticate, requireChiefAdminRole } = require('../middleware/auth.middleware');
const { CHIEF_ADMIN_ROLES } = require('../utils/roles');
const { runWithActor, getCurrentActor } = require('../utils/auditContext');
const testCtrl = require('../controllers/testMaster.controller');
const titleCtrl = require('../controllers/patientTitle.controller');

// 50 MB covers a few hundred thousand rows of the tests & parameters sheet.
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

// multer finishes inside the file stream's callbacks, which drops the
// request's audit context - re-enter it so rows created from the upload are
// stamped with who uploaded them rather than "SYSTEM".
function uploadFile(req, res, next) {
  const actor = getCurrentActor();
  upload.single('file')(req, res, (err) => {
    if (err?.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ message: 'File is larger than 50 MB - please split it into smaller sheets.' });
    return err ? next(err) : runWithActor(actor, next);
  });
}

// Chief Admin can also manage the global Test Master (same central data
// client-side MASTER_MANAGER users manage under /api/masters/tests).
// Restricted to the ADMIN role - Marketing staff don't touch master data.
router.use(authenticate, requireChiefAdminRole(CHIEF_ADMIN_ROLES.ADMIN));

router.get('/groups', testCtrl.listTestGroups);
router.post('/groups', testCtrl.createTestGroup);

// Patient titles (Mr./Mrs./...) offered in every client's billing screen
router.get('/patient-titles', titleCtrl.listPatientTitles);
router.post('/patient-titles', titleCtrl.createPatientTitle);
router.put('/patient-titles/:id', titleCtrl.updatePatientTitle);
router.delete('/patient-titles/:id', titleCtrl.deletePatientTitle);

router.get('/tests', testCtrl.listTests);
router.post('/tests', testCtrl.createTest);
router.post('/tests/bulk', testCtrl.bulkTestAction);
router.put('/tests/:id', testCtrl.updateTest);
router.get('/tests/:id/usage', testCtrl.testUsage);
router.delete('/tests/:id', testCtrl.deleteTest);
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

router.get('/tests/template', testCtrl.downloadTemplate);
router.post('/tests/upload/preview', uploadFile, testCtrl.previewUpload);
router.post('/tests/upload/commit', uploadFile, testCtrl.commitUpload);

module.exports = router;

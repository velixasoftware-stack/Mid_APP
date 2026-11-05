const router = require('express').Router();
const multer = require('multer');
const { authenticate } = require('../middleware/auth.middleware');
const { requireRole } = require('../middleware/role.middleware');
const { requireActiveSubscription } = require('../middleware/subscription.middleware');
const { ROLES } = require('../utils/roles');
const ctrl = require('../controllers/clientBranding.controller');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

router.use(authenticate, requireActiveSubscription, requireRole(ROLES.MANAGER));

router.get('/', ctrl.getBranding);
router.post('/', upload.fields([{ name: 'logo', maxCount: 1 }, { name: 'letterhead', maxCount: 1 }]), ctrl.uploadBranding);

router.get('/doctors', ctrl.listDoctorUsers);
router.put('/doctors/:userId', ctrl.setDoctorDesignation);
router.post('/doctors/:userId/signature', upload.single('signature'), ctrl.uploadDoctorSignature);

module.exports = router;

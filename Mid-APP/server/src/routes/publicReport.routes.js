const router = require('express').Router();
const { publicReportLimiter } = require('../middleware/rateLimit');
const labCtrl = require('../controllers/lab.controller');

// No login: the link in a report's QR code (see getPublicReport).
router.get('/reports/:token', publicReportLimiter, labCtrl.getPublicReport);

module.exports = router;

const router = require('express').Router();

router.use('/auth', require('./auth.routes'));
router.use('/clients', require('./client.routes'));
router.use('/locations', require('./location.routes'));
router.use('/payments', require('./payment.routes'));
router.use('/masters', require('./master.routes'));
router.use('/test-config', require('./testConfig.routes'));
router.use('/admin/masters', require('./adminMaster.routes'));
router.use('/chief-admin-users', require('./chiefAdminUser.routes'));
router.use('/patients', require('./patient.routes'));
router.use('/doctors', require('./doctor.routes'));
router.use('/billing', require('./billing.routes'));
router.use('/billing-settings', require('./billingSettings.routes'));
router.use('/lab', require('./lab.routes'));
router.use('/report-view', require('./reportView.routes'));
router.use('/reports', require('./report.routes'));
router.use('/public', require('./publicReport.routes')); // no login - report QR links
router.use('/tickets', require('./ticket.routes'));
router.use('/branding', require('./branding.routes'));
router.use('/notification-settings', require('./notificationSettings.routes'));
router.use('/notification-templates', require('./notificationTemplate.routes'));
router.use('/role-screen-defaults', require('./roleScreenDefault.routes'));
router.use('/role-screens', require('./roleScreen.routes'));
router.use('/payor-invoices', require('./payorInvoice.routes'));
router.use('/announcements', require('./announcement.routes'));

module.exports = router;

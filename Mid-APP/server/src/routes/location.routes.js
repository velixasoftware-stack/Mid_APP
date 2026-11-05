const router = require('express').Router();
const { authenticate } = require('../middleware/auth.middleware');
const locationCtrl = require('../controllers/clientLocation.controller');

// Client staff: this client's locations (set up by Chief Admin), read only.
router.get('/', authenticate, locationCtrl.listMyLocations);

module.exports = router;

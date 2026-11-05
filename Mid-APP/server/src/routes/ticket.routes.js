const router = require('express').Router();
const { authenticate } = require('../middleware/auth.middleware');
const ticketCtrl = require('../controllers/ticket.controller');

// Tickets are attended to by the Chief Admin's ADMIN or MARKETING staff (MARKETING
// only for their own assigned clients - see ticket.controller), or a client's own ADMIN.
function requireChiefAdminOrClientAdmin(req, res, next) {
  if (req.user.type === 'CHIEF_ADMIN' && (req.user.roles || []).some((r) => ['ADMIN', 'MARKETING'].includes(r))) return next();
  if (req.user.type === 'CLIENT_USER' && (req.user.roles || []).includes('ADMIN')) return next();
  return res.status(403).json({ message: 'Only an Admin can manage tickets' });
}

router.use(authenticate);

// Any logged-in client user can raise a ticket, even while payment is pending.
router.post('/', ticketCtrl.createTicket);
router.get('/', ticketCtrl.listTickets);
router.put('/:id/assign', requireChiefAdminOrClientAdmin, ticketCtrl.assignTicket);
router.put('/:id/resolve', requireChiefAdminOrClientAdmin, ticketCtrl.resolveTicket);
router.put('/:id/close', requireChiefAdminOrClientAdmin, ticketCtrl.closeTicket);

module.exports = router;

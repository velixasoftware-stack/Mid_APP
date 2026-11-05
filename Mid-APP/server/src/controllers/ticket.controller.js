const { Op } = require('sequelize');
const { Ticket, Client } = require('../models');
const { isMarketingOnly } = require('../middleware/auth.middleware');

// POST /api/tickets  (client user opens a ticket)
async function createTicket(req, res) {
  const { clientId } = req.user;
  const { subject, description } = req.body;
  if (!subject) return res.status(400).json({ message: 'subject is required' });

  const ticket = await Ticket.create({ clientId, subject, description, status: 'OPEN' });
  return res.status(201).json(ticket);
}

// GET /api/tickets  (Chief Admin ADMIN role sees all, client user sees own client's)
// Which clients' tickets this user may see/manage: a client user -> their own
// client; a MARKETING-only Chief Admin user -> the clients assigned to them;
// Chief Admin ADMIN -> all (null).
async function ticketClientScope(req) {
  if (req.user.type === 'CLIENT_USER') return [req.user.clientId];
  if (isMarketingOnly(req)) {
    const mine = await Client.findAll({ where: { salesPerson: { [Op.iLike]: req.user.username } }, attributes: ['id'] });
    return mine.map((c) => c.id);
  }
  return null;
}

// Loads a ticket the current user is allowed to act on, or sends the error.
async function findManageableTicket(req, res) {
  const ticket = await Ticket.findByPk(req.params.id);
  if (!ticket) { res.status(404).json({ message: 'Ticket not found' }); return null; }
  const scope = await ticketClientScope(req);
  if (scope && !scope.includes(ticket.clientId)) { res.status(403).json({ message: 'This ticket is not from one of your clients' }); return null; }
  return ticket;
}

async function listTickets(req, res) {
  const where = {};
  const scope = await ticketClientScope(req);
  if (scope) where.clientId = scope;
  const { status } = req.query;
  if (status) where.status = status;

  const tickets = await Ticket.findAll({ where, include: [Client], order: [['createdAt', 'DESC']] });
  return res.json(tickets);
}

// PUT /api/tickets/:id/assign  (Admin)
async function assignTicket(req, res) {
  const { assignedTo } = req.body;
  const ticket = await findManageableTicket(req, res);
  if (!ticket) return;
  await ticket.update({ assignedTo, status: 'ASSIGNED' });
  return res.json(ticket);
}

// PUT /api/tickets/:id/resolve
async function resolveTicket(req, res) {
  const ticket = await findManageableTicket(req, res);
  if (!ticket) return;
  await ticket.update({ status: 'RESOLVED' });
  return res.json(ticket);
}

// PUT /api/tickets/:id/close
async function closeTicket(req, res) {
  const ticket = await findManageableTicket(req, res);
  if (!ticket) return;
  await ticket.update({ status: 'CLOSED' });
  return res.json(ticket);
}

module.exports = { createTicket, listTickets, assignTicket, resolveTicket, closeTicket };

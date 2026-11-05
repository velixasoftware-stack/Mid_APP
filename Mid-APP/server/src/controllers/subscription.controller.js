const { ClientSubscription, Client } = require('../models');
const { Op } = require('sequelize');
const { createInitialSubscription, currentMonthRange } = require('./client.controller');

// GET /api/clients/:clientId/subscriptions
async function listSubscriptions(req, res) {
  const subs = await ClientSubscription.findAll({
    where: { clientId: req.params.clientId },
    order: [['fromDate', 'DESC']],
  });
  return res.json(subs);
}

/**
 * Today as a local 'YYYY-MM-DD' string. The cycle columns are DATEONLY, so
 * comparing them against a full timestamp (midnight-cast in Postgres) would
 * drop a cycle on its own last day - e.g. a 1-day free grant never applied.
 */
function todayDateOnly() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** A one-month range starting today, for a fresh cycle once a client has nothing covering today. */
function monthFromToday() {
  const from = new Date();
  const to = new Date(from);
  to.setMonth(to.getMonth() + 1);
  to.setDate(to.getDate() - 1);
  return { from, to };
}

/**
 * The subscription cycle (Start Date/End Date range) that covers today, if
 * any. A PAID cycle wins over an unpaid one covering the same day - free days
 * granted on top of a pending cycle must give access for exactly that range,
 * after which the pending cycle (still covering today) takes over and the
 * client is asked to pay again.
 */
async function findCurrentCycle(clientId) {
  const today = todayDateOnly();
  return ClientSubscription.findOne({
    where: { clientId, fromDate: { [Op.lte]: today }, toDate: { [Op.gte]: today } },
    order: [[ClientSubscription.sequelize.literal(`CASE WHEN "status" = 'PAID' THEN 0 ELSE 1 END`), 'ASC'], ['toDate', 'DESC']],
  });
}

/** Returns the subscription cycle covering today, creating a one-month one from today if none exists. */
async function getOrCreateCurrentSubscription(clientId) {
  let sub = await findCurrentCycle(clientId);
  if (!sub) {
    const client = await Client.findByPk(clientId);
    // Not createInitialSubscription's calendar-month default - that is based on
    // client.createdAt, so for a lapsed client it creates a cycle in the past
    // (that never covers today) on every call.
    sub = await createInitialSubscription(client, undefined, monthFromToday());
  }
  return sub;
}

// GET /api/clients/:clientId/subscriptions/current
async function getCurrentSubscription(req, res) {
  const sub = await getOrCreateCurrentSubscription(req.params.clientId);
  return res.json(sub);
}

/**
 * Recomputes a client's paymentStatus from its subscription date ranges:
 * PAID while today falls within a PAID cycle, EXPIRED once that cycle's End
 * Date has passed (or a PENDING cycle's due date passed), PENDING while
 * inside a not-yet-due unpaid cycle. This is the single source of truth for
 * whether a client login should be granted access, so it is re-checked on
 * every protected request as well as on login and by the daily job below.
 */
async function syncClientPaymentStatus(clientId) {
  const cycle = await findCurrentCycle(clientId);
  const today = todayDateOnly();

  let status;
  if (!cycle) {
    status = 'EXPIRED'; // no subscription cycle (Start Date-End Date) covers today
  } else if (cycle.status === 'PAID') {
    status = 'PAID';
  } else if (cycle.status === 'PENDING' && today > cycle.dueDate) {
    await cycle.update({ status: 'EXPIRED' });
    status = 'EXPIRED';
  } else {
    status = cycle.status;
  }

  await Client.update({ paymentStatus: status }, { where: { id: clientId } });
  return status;
}

/**
 * Re-syncs every active client's paymentStatus against its subscription date
 * ranges. Run once at server boot and on a daily interval so clients whose
 * End Date/due date lapses get blocked even without an incoming request.
 */
async function expireOverdueSubscriptions() {
  const clients = await Client.findAll({ where: { active: true }, attributes: ['id'] });
  for (const client of clients) {
    await syncClientPaymentStatus(client.id);
  }
}

/**
 * Creates `count` consecutive monthly cycles immediately after
 * `afterSubscription`, in the given status. `amountOverride`, when given, is
 * used instead of `afterSubscription.amount` - needed so chaining off a free
 * promotional cycle (amount 0) doesn't make every cycle after it free too.
 */
async function createChainedCycles(afterSubscription, count, status = 'PAID', amountOverride) {
  let prevTo = new Date(afterSubscription.toDate);
  const created = [];
  for (let i = 0; i < count; i++) {
    const from = new Date(prevTo);
    from.setDate(from.getDate() + 1);
    const to = new Date(from);
    to.setMonth(to.getMonth() + 1);
    to.setDate(to.getDate() - 1);
    const month = `${from.getFullYear()}-${String(from.getMonth() + 1).padStart(2, '0')}`;

    const cycle = await ClientSubscription.create({
      clientId: afterSubscription.clientId,
      month,
      fromDate: from,
      toDate: to,
      dueDate: to,
      amount: amountOverride ?? afterSubscription.amount,
      status,
    });
    created.push(cycle);
    prevTo = to;
  }
  return created;
}

/**
 * For an advance/bulk payment covering more than one month, creates the
 * extra consecutive cycles immediately after `subscription`, pre-marked
 * PAID, so the client's access runs uninterrupted through all of them.
 */
async function createAdvanceCycles(subscription, extraMonths) {
  return createChainedCycles(subscription, extraMonths, 'PAID');
}

/**
 * Resolves the subscription cycle a new payment should apply to. Usually
 * that's the cycle covering today when it isn't paid yet. But a client who
 * is already paid through some date can also choose to top up / pay in
 * advance proactively — in that case there's no due cycle to attach to, so
 * this opens a fresh PENDING cycle chained right after their latest paid
 * one (or after whatever their latest cycle is, if none is paid at all).
 */
async function getOrCreatePayableSubscription(clientId) {
  const todayCycle = await findCurrentCycle(clientId);
  if (todayCycle && todayCycle.status !== 'PAID') return todayCycle;

  const latest = await ClientSubscription.findOne({ where: { clientId }, order: [['toDate', 'DESC']] });
  if (!latest) {
    const client = await Client.findByPk(clientId);
    return createInitialSubscription(client, undefined, monthFromToday());
  }
  if (latest.status !== 'PAID') return latest; // unpaid and not covering today either (a lapsed gap) - reuse it

  // Always the client's current real rate, not latest.amount - which would
  // incorrectly be 0 if the latest cycle happened to be a free trial.
  const client = await Client.findByPk(clientId);
  const [nextCycle] = await createChainedCycles(latest, 1, 'PENDING', client.monthlyAmount);
  return nextCycle;
}

/** The furthest date a client is currently paid through, so an advance payment visibly reflects on their record. */
async function getPaidThroughDate(clientId) {
  const latestPaid = await ClientSubscription.findOne({
    where: { clientId, status: 'PAID' },
    order: [['toDate', 'DESC']],
  });
  return latestPaid ? latestPaid.toDate : null;
}

// POST /api/clients/:clientId/free-days  Body: { days }
// Grants a promotional free period for an existing client - e.g. "give them
// 15 more days, no charge" - as a new PAID/amount-0 cycle chained right
// after whatever they're currently paid through (or starting today if
// nothing covers today/they've already lapsed). Mirrors how a free trial is
// set up at client creation (createInitialSubscription's `free` flag), just
// for a client that already exists.
async function grantFreeDays(req, res) {
  const client = await Client.findByPk(req.params.clientId);
  if (!client) return res.status(404).json({ message: 'Client not found' });

  const days = Number(req.body.days);
  if (!Number.isInteger(days) || days <= 0) {
    return res.status(400).json({ message: 'days must be a positive whole number' });
  }

  // Starts the day after they're paid through - but never in the past: a
  // lapsed client's free days start today, otherwise they'd be spent already.
  const paidThrough = await getPaidThroughDate(client.id);
  const today = todayDateOnly();
  const from = new Date(); // local today
  if (paidThrough && paidThrough >= today) {
    const [y, m, d] = paidThrough.split('-').map(Number);
    from.setFullYear(y, m - 1, d + 1);
  }
  const to = new Date(from);
  to.setDate(to.getDate() + days - 1);
  const month = `${from.getFullYear()}-${String(from.getMonth() + 1).padStart(2, '0')}`;

  const cycle = await ClientSubscription.create({
    clientId: client.id, month, fromDate: from, toDate: to, dueDate: to, amount: 0, status: 'PAID',
  });
  await syncClientPaymentStatus(client.id);
  return res.status(201).json(cycle);
}

module.exports = {
  listSubscriptions,
  getCurrentSubscription,
  getOrCreateCurrentSubscription,
  getOrCreatePayableSubscription,
  syncClientPaymentStatus,
  expireOverdueSubscriptions,
  createAdvanceCycles,
  getPaidThroughDate,
  grantFreeDays,
};

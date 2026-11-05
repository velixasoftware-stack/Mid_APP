const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { Client, ClientSubscription, ClientUser, Role, ChiefAdmin, Bill, ClientPayment, sequelize } = require('../models');
const { activeLocations, resolveLoginLocation, locationInfo } = require('../utils/location');
const { Op, fn, col } = require('sequelize');
const { calculatePlanAmount } = require('../utils/pricing');
const { signToken } = require('../utils/jwt');
const { isMarketingOnly } = require('../middleware/auth.middleware');

/**
 * Generates the next available Client Code, e.g. SG0001 (self-signup) or
 * CLI0002 (Chief-Admin-created). Both client-creation paths share one
 * sequence number - only the leading prefix marks which one created it,
 * there's no separate suffix and no per-source counter.
 */
async function generateClientCode(source) {
  const prefix = source === 'CHIEF_ADMIN' ? 'CLI' : 'SG';

  // The shared sequence number is the highest one already in use across every
  // existing client code, regardless of its prefix - not a row count, which
  // would collide with a manually-typed code from before this scheme.
  const clients = await Client.findAll({ attributes: ['clientCode'] });
  let maxN = 0;
  for (const c of clients) {
    const match = c.clientCode.match(/(\d+)/);
    if (match) maxN = Math.max(maxN, parseInt(match[1], 10));
  }

  let n = maxN + 1;
  let code = `${prefix}${String(n).padStart(4, '0')}`;
  while (await Client.findOne({ where: { clientCode: code } })) {
    n += 1;
    code = `${prefix}${String(n).padStart(4, '0')}`;
  }
  return code;
}

// Username of the support login auto-created on every client (see createClient).
const SYSTEM_USERNAME = 'chiefadmin';

// Turns a raw Sequelize unique/validation failure (whose message is just
// "Validation error") into something a person can act on.
function friendlyDbError(err) {
  if (err?.name === 'SequelizeUniqueConstraintError') {
    const fields = Object.keys(err.fields || {});
    if (fields.includes('username')) return `Username "${err.fields.username}" already exists for this client - please choose another.`;
    if (fields.includes('clientCode')) return 'That client code was just taken - please submit again.';
    return `Duplicate value for ${fields.join(', ') || 'a unique field'} - please check and try again.`;
  }
  if (err?.name === 'SequelizeValidationError') {
    return (err.errors || []).map((e) => e.message).join('; ') || err.message;
  }
  return err?.message;
}

// When set, every client's Chief Admin support login shares this ONE
// password, so Chief Admin doesn't have to look up or remember a different
// one per client to use the Client Login tab as "chiefadmin" ("Log In as
// This Client" on Client Detail skips needing it at all, but this still
// matters for anyone using the plain login form). Never hardcoded here -
// only ever read from the environment (see .env.example), so no real
// password value ends up committed to source control. Left unset, each
// client's support login instead gets its own random password, same as
// before this feature existed.
const SUPPORT_LOGIN_PASSWORD = process.env.SUPPORT_LOGIN_PASSWORD || null;

// A readable random password, used for a client's support login only when
// SUPPORT_LOGIN_PASSWORD isn't configured - short hex is secure but
// impossible to read/type back; this trades a little entropy for something
// a person can actually copy and use right after client creation.
function generateReadablePassword() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  let pw = '';
  for (let i = 0; i < 12; i += 1) pw += chars[crypto.randomInt(chars.length)];
  return pw;
}

function currentMonthRange(date = new Date()) {
  const from = new Date(date.getFullYear(), date.getMonth(), 1);
  const to = new Date(date.getFullYear(), date.getMonth() + 1, 0);
  const due = new Date(date.getFullYear(), date.getMonth(), 10);
  const month = `${from.getFullYear()}-${String(from.getMonth() + 1).padStart(2, '0')}`;
  return { month, from, to, due };
}

/**
 * Creates a subscription cycle for a client. When `range` ({ from, to }) is
 * given (e.g. the Start Date / End Date chosen at client creation) it is used
 * as-is, with the due date equal to the end date; otherwise the cycle
 * defaults to the current calendar month (used for auto-renewals).
 */
// `free` (a promotional trial period, e.g. "free for 15 days") marks this
// first cycle PAID with amount 0 instead of the usual PENDING/monthlyAmount -
// access is granted immediately with nothing to collect, and the client's
// very next cycle (created later by getOrCreatePayableSubscription once this
// one lapses) correctly charges the real monthlyAmount again, not 0.
async function createInitialSubscription(client, t, range, free = false) {
  let month, from, to, due;
  if (range?.from && range?.to) {
    from = new Date(range.from);
    to = new Date(range.to);
    due = to;
    month = `${from.getFullYear()}-${String(from.getMonth() + 1).padStart(2, '0')}`;
  } else {
    ({ month, from, to, due } = currentMonthRange(new Date(client.createdAt || Date.now())));
  }

  return ClientSubscription.create({
    clientId: client.id,
    month,
    fromDate: from,
    toDate: to,
    dueDate: due,
    amount: free ? 0 : client.monthlyAmount,
    status: free ? 'PAID' : 'PENDING',
  }, { transaction: t });
}

// POST /api/clients  (Chief Admin)
// Body: { clientName, ..., startDate, endDate, users: [{ username, password, name, roleName }] }
// The Client Code is always generated here, never chosen by the caller - see
// generateClientCode's -CA suffix, shared sequence with self-signup's -SU.
// monthlyAmount defaults to the plan (₹2000/month covers 2 users, +₹500/month
// for each user beyond that) plus marketingPersonPrice, but Chief Admin can
// override it with an explicit monthlyAmount in the request (e.g. a custom
// negotiated rate) - if given, that figure is used as-is instead.
async function createClient(req, res) {
  const {
    clientName, mobile, email, address, salesPerson, marketingPersonPrice, monthlyAmount: monthlyAmountOverride,
    startDate, endDate, users, qrPaymentRequired, isFreeTrial,
  } = req.body;

  if (!clientName || !startDate || !endDate) {
    return res.status(400).json({
      message: 'clientName, startDate and endDate are required',
    });
  }
  if (new Date(endDate) < new Date(startDate)) {
    return res.status(400).json({ message: 'endDate cannot be before startDate' });
  }

  const clientCode = await generateClientCode('CHIEF_ADMIN');
  // A client a MARKETING user onboards is always assigned to that user.
  const assignedSalesPerson = isMarketingOnly(req) ? req.user.username : salesPerson;

  const userList = Array.isArray(users) ? users : [];
  const seenUsernames = new Set();
  for (const u of userList) {
    const roleNames = Array.isArray(u.roleNames) ? u.roleNames : (u.roleName ? [u.roleName] : []);
    u.roleNames = roleNames;
    u.username = (u.username || '').toString().trim();
    if (!u.username || !u.password || roleNames.length === 0) {
      return res.status(400).json({ message: 'Each user needs a username, password and at least one role' });
    }
    // Checked up front - both would otherwise hit the (clientId, username)
    // unique index mid-transaction and surface only as "Validation error".
    const key = u.username.toLowerCase();
    if (key === SYSTEM_USERNAME) {
      return res.status(400).json({ message: `"${u.username}" is reserved for the Chief Admin support login - please use another username (e.g. admin).` });
    }
    if (seenUsernames.has(key)) {
      return res.status(400).json({ message: `Username "${u.username}" is entered more than once - each user needs a different username.` });
    }
    seenUsernames.add(key);
  }

  const marketingFee = Number(marketingPersonPrice) || 0;
  if (marketingFee < 0) return res.status(400).json({ message: 'marketingPersonPrice cannot be negative' });

  let monthlyAmount;
  if (monthlyAmountOverride != null && monthlyAmountOverride !== '') {
    monthlyAmount = Number(monthlyAmountOverride);
    if (Number.isNaN(monthlyAmount) || monthlyAmount < 0) {
      return res.status(400).json({ message: 'monthlyAmount must be a non-negative number' });
    }
  } else {
    monthlyAmount = calculatePlanAmount(userList.length) + marketingFee;
  }

  try {
    const result = await sequelize.transaction(async (t) => {
      const client = await Client.create({
        clientCode, clientName, mobile, email, address, salesPerson: assignedSalesPerson,
        marketingPersonPrice: marketingFee, monthlyAmount,
        // A free trial's initial cycle is already PAID (see createInitialSubscription
        // below) - reflect that immediately instead of showing PENDING until the next
        // login/sync job happens to re-derive it.
        paymentStatus: isFreeTrial ? 'PAID' : 'PENDING',
        qrPaymentRequired: qrPaymentRequired !== false,
      }, { transaction: t });

      await createInitialSubscription(client, t, { from: startDate, to: endDate }, !!isFreeTrial);

      const createdUsers = [];
      for (const u of userList) {
        const roles = await Role.findAll({ where: { name: u.roleNames }, transaction: t });
        if (roles.length !== u.roleNames.length) {
          const found = new Set(roles.map((r) => r.name));
          const missing = u.roleNames.filter((n) => !found.has(n));
          throw new Error(`Unknown role(s): ${missing.join(', ')}`);
        }
        const passwordHash = await bcrypt.hash(u.password, 10);
        const created = await ClientUser.create({
          clientId: client.id, username: u.username, passwordHash, name: u.name,
          department: u.department, designation: u.designation,
        }, { transaction: t });
        await created.setRoles(roles, { transaction: t });
        createdUsers.push({ id: created.id, username: created.username, roles: roles.map((r) => r.name) });
      }

      // One Chief-Admin support login per client, auto-created here - lets
      // Chief Admin log in (client code + "chiefadmin" + the standard
      // support password below - the same on every client if
      // SUPPORT_LOGIN_PASSWORD is configured, otherwise a fresh random one
      // just for this client) to help troubleshoot, without ever touching
      // the client's own credentials. Never counted as one of the client's
      // own billable users.
      const adminRole = await Role.findOne({ where: { name: 'ADMIN' }, transaction: t });
      let systemUserCredentials = null;
      if (adminRole) {
        const systemPassword = SUPPORT_LOGIN_PASSWORD || generateReadablePassword();
        const systemUser = await ClientUser.create({
          clientId: client.id, username: 'chiefadmin',
          passwordHash: await bcrypt.hash(systemPassword, 10),
          name: 'Chief Admin Support', isSystemUser: true,
        }, { transaction: t });
        await systemUser.setRoles([adminRole], { transaction: t });
        systemUserCredentials = { username: 'chiefadmin', password: systemPassword };
      }

      return { client, users: createdUsers, systemUser: systemUserCredentials };
    });

    return res.status(201).json(result);
  } catch (err) {
    return res.status(400).json({ message: friendlyDbError(err) || 'Failed to create client' });
  }
}

/** The furthest date a client is paid through, so an advance payment visibly reflects on their record. */
async function getPaidThroughDate(clientId) {
  const latestPaid = await ClientSubscription.findOne({
    where: { clientId, status: 'PAID' },
    order: [['toDate', 'DESC']],
  });
  return latestPaid ? latestPaid.toDate : null;
}

// Filters a query by `column` falling within [from, to] (either end optional,
// `to` made inclusive of its whole calendar day) - silently no-ops on
// missing/invalid dates, same convention as report.controller.js's
// dateRangeWhere.
function dateRangeWhereOn(column, from, to) {
  const fromDate = from ? new Date(from) : null;
  const toDate = to ? new Date(to) : null;
  const validFrom = fromDate && !Number.isNaN(fromDate.getTime()) ? fromDate : null;
  const validTo = toDate && !Number.isNaN(toDate.getTime()) ? toDate : null;
  if (!validFrom && !validTo) return {};

  const range = {};
  if (validFrom) range[Op.gte] = validFrom;
  if (validTo) {
    const end = new Date(validTo);
    end.setHours(23, 59, 59, 999);
    range[Op.lte] = end;
  }
  return { [column]: range };
}

// GET /api/clients  (Chief Admin) - client-wise payment dashboard
// Optional ?from=&to= filters the lab-billing revenue/bill-count and
// SaaS-payments-collected figures below to that date range - the client
// list itself and its PAID/PENDING/EXPIRED counts are always current-state,
// not date-scoped (a client's status today doesn't depend on which date
// range you're looking at).
async function listClients(req, res) {
  const { status, from, to } = req.query;
  const where = status ? { paymentStatus: status } : {};
  // A MARKETING-only user sees just the clients assigned to them.
  const marketingOnly = isMarketingOnly(req);
  if (marketingOnly) where.salesPerson = { [Op.iLike]: req.user.username };
  const clients = await Client.findAll({
    where,
    include: [{ model: ClientUser, attributes: ['id'], where: { isSystemUser: false }, required: false }],
    order: [['createdAt', 'DESC']],
  });

  const paidThroughByClient = {};
  for (const c of clients) {
    paidThroughByClient[c.id] = await getPaidThroughDate(c.id);
  }

  // Lab-billing revenue (what each client has collected from their own
  // patients), distinct from monthlyRevenue* above which is the SaaS
  // subscription fee they pay us. Filtered by the bill's own date when a
  // range is given.
  const clientIdFilter = marketingOnly ? { clientId: clients.map((c) => c.id) } : {};
  const billStats = await Bill.findAll({
    where: { ...dateRangeWhereOn('createdAt', from, to), ...clientIdFilter },
    attributes: ['clientId', [fn('COUNT', col('id')), 'billCount'], [fn('COALESCE', fn('SUM', col('paidAmount')), 0), 'revenueCollected']],
    group: ['clientId'],
    raw: true,
  });
  const billStatsByClient = {};
  for (const row of billStats) billStatsByClient[row.clientId] = row;

  // Actual SaaS subscription payments collected (ClientPayment rows, not
  // just "is this client currently PAID") - this is what a date range
  // genuinely means for "payments", unlike monthlyRevenueCollected below
  // which reflects the client's current status, not a historical window.
  const paymentStats = await ClientPayment.findAll({
    where: { status: 'PAID', ...dateRangeWhereOn('paymentDate', from, to), ...clientIdFilter },
    attributes: ['clientId', [fn('COALESCE', fn('SUM', col('amount')), 0), 'paymentsCollected']],
    group: ['clientId'],
    raw: true,
  });
  const paymentStatsByClient = {};
  for (const row of paymentStats) paymentStatsByClient[row.clientId] = row;

  const summary = {
    total: clients.length,
    paid: clients.filter((c) => c.paymentStatus === 'PAID').length,
    pending: clients.filter((c) => c.paymentStatus === 'PENDING').length,
    expired: clients.filter((c) => c.paymentStatus === 'EXPIRED').length,
    monthlyRevenueBooked: clients.reduce((sum, c) => sum + Number(c.monthlyAmount), 0),
    monthlyRevenueCollected: clients
      .filter((c) => c.paymentStatus === 'PAID')
      .reduce((sum, c) => sum + Number(c.monthlyAmount), 0),
    labBillCount: billStats.reduce((sum, r) => sum + Number(r.billCount), 0),
    labRevenueCollected: billStats.reduce((sum, r) => sum + Number(r.revenueCollected), 0),
    paymentsCollected: paymentStats.reduce((sum, r) => sum + Number(r.paymentsCollected), 0),
  };
  // For a MARKETING-only user every figure above - counts and revenue - is
  // already limited to the clients assigned to them.

  const data = clients.map((c) => ({
    id: c.id,
    clientCode: c.clientCode,
    clientName: c.clientName,
    mobile: c.mobile,
    email: c.email,
    salesPerson: c.salesPerson,
    marketingPersonPrice: c.marketingPersonPrice,
    monthlyAmount: c.monthlyAmount,
    paymentStatus: c.paymentStatus,
    active: c.active,
    userCount: c.ClientUsers?.length || 0,
    createdAt: c.createdAt,
    paidThrough: paidThroughByClient[c.id],
    labBillCount: Number(billStatsByClient[c.id]?.billCount || 0),
    labRevenueCollected: Number(billStatsByClient[c.id]?.revenueCollected || 0),
    paymentsCollected: Number(paymentStatsByClient[c.id]?.paymentsCollected || 0),
  }));

  return res.json({ summary, clients: data });
}

// GET /api/clients/:id
async function getClient(req, res) {
  const client = await Client.findByPk(req.params.id, {
    include: [ClientSubscription, { model: ClientUser, include: [Role] }],
  });
  if (!client) return res.status(404).json({ message: 'Client not found' });

  const paidThrough = await getPaidThroughDate(client.id);
  return res.json({ ...client.toJSON(), paidThrough });
}

// POST /api/clients/:id/impersonate  (Chief Admin, ADMIN role only)
// Finds (or provisions, if a backfill somehow hasn't run yet) this client's
// auto-created support ClientUser and mints a fresh CLIENT_USER session for
// it - shared by impersonateClient (Chief Admin dashboard's "Open as this
// client" button) and clientUserLogin's fallback (any Chief Admin typing
// their OWN username/password into the ordinary client-login form, with
// that client's Client Code, instead of needing to know/reset that specific
// client's separate chiefadmin support password).
// locationId: the location picked on the login screen (Main when none).
async function mintSystemUserSession(client, locationId = null) {
  let systemUser = await ClientUser.findOne({ where: { clientId: client.id, isSystemUser: true } });
  if (!systemUser) {
    const adminRole = await Role.findOne({ where: { name: 'ADMIN' } });
    if (!adminRole) return { error: 'ADMIN role not configured' };
    systemUser = await ClientUser.create({
      clientId: client.id, username: 'chiefadmin',
      passwordHash: await bcrypt.hash(SUPPORT_LOGIN_PASSWORD || generateReadablePassword(), 10),
      name: 'Chief Admin Support', isSystemUser: true,
    });
    await systemUser.setRoles([adminRole]);
  }
  if (!systemUser.active) return { error: "This client's support login has been deactivated" };

  const locations = await activeLocations(client.id);
  const picked = locationId ? await resolveLoginLocation(client.id, null, locationId) : { location: locations[0] || null };
  if (picked.error) return { error: picked.error };

  const roles = (await systemUser.getRoles()).map((r) => r.name);
  // A fresh session id evicts any session already active for this support
  // login elsewhere, same single-session rule every other login follows.
  const sessionId = crypto.randomUUID();
  await systemUser.update({ currentSessionId: sessionId });
  const token = signToken({
    type: 'CLIENT_USER', id: systemUser.id, clientId: client.id, clientCode: client.clientCode, roles, sessionId,
    locationId: picked.location?.id || null,
  });

  // Required lazily (not at module top) to avoid a require() cycle:
  // subscription.controller.js itself requires client.controller.js.
  const { syncClientPaymentStatus } = require('./subscription.controller');
  const paymentStatus = await syncClientPaymentStatus(client.id);

  return {
    token,
    user: { id: systemUser.id, username: systemUser.username, name: systemUser.name, roles, type: 'CLIENT_USER' },
    client: {
      id: client.id, clientCode: client.clientCode, clientName: client.clientName,
      paymentStatus, allowBillCancellationRefund: client.allowBillCancellationRefund,
      qrPaymentRequired: client.qrPaymentRequired,
      ...(await locationInfo(client.id, picked.location)),
    },
  };
}

// Opens this client's app for support/troubleshooting without a Chief Admin
// ever needing to know or type that client's clientCode + the "chiefadmin"
// support login's password.
async function impersonateClient(req, res) {
  const client = await Client.findByPk(req.params.id);
  if (!client) return res.status(404).json({ message: 'Client not found' });

  const session = await mintSystemUserSession(client);
  if (session.error) return res.status(400).json({ message: session.error });

  console.log(`Chief Admin "${req.user.username}" opened client ${client.clientCode} (${client.clientName}) via impersonation.`);
  return res.json(session);
}

// GET /api/clients/:clientId/revenue
// Lab-billing revenue this client has collected from their own patients -
// distinct from the SaaS subscription payments tracked in ClientPayment.
async function getClientRevenue(req, res) {
  const client = await Client.findByPk(req.params.clientId);
  if (!client) return res.status(404).json({ message: 'Client not found' });

  const { from, to } = currentMonthRange();
  const where = { clientId: client.id };

  const [totals, thisMonth] = await Promise.all([
    Bill.findOne({
      where,
      attributes: [
        [fn('COUNT', col('id')), 'billCount'],
        [fn('COALESCE', fn('SUM', col('paidAmount')), 0), 'revenueCollected'],
        [fn('COALESCE', fn('SUM', col('discount')), 0), 'discountGiven'],
        [fn('COALESCE', fn('SUM', col('dueAmount')), 0), 'dueOutstanding'],
      ],
      raw: true,
    }),
    Bill.findOne({
      where: { ...where, createdAt: { [Op.between]: [from, to] } },
      attributes: [
        [fn('COUNT', col('id')), 'billCount'],
        [fn('COALESCE', fn('SUM', col('paidAmount')), 0), 'revenueCollected'],
      ],
      raw: true,
    }),
  ]);

  return res.json({
    totalBillCount: Number(totals.billCount),
    totalRevenueCollected: Number(totals.revenueCollected),
    totalDiscountGiven: Number(totals.discountGiven),
    totalDueOutstanding: Number(totals.dueOutstanding),
    thisMonthBillCount: Number(thisMonth.billCount),
    thisMonthRevenueCollected: Number(thisMonth.revenueCollected),
  });
}

// PUT /api/clients/:id
// monthlyAmount itself is intentionally not directly editable here - it's
// always derived from the plan (see calculatePlanAmount) plus
// marketingPersonPrice, recomputed here whenever marketingPersonPrice changes
// so a later adjustment still bills correctly from the next cycle.
async function updateClient(req, res) {
  const client = await Client.findByPk(req.params.id);
  if (!client) return res.status(404).json({ message: 'Client not found' });

  const {
    clientName, mobile, email, address, salesPerson, marketingPersonPrice, active, allowBillCancellationRefund,
    qrPaymentRequired,
  } = req.body;

  let monthlyAmount = client.monthlyAmount;
  let marketingFee = client.marketingPersonPrice;
  if (marketingPersonPrice != null) {
    marketingFee = Number(marketingPersonPrice) || 0;
    if (marketingFee < 0) return res.status(400).json({ message: 'marketingPersonPrice cannot be negative' });
    const userCount = await ClientUser.count({ where: { clientId: client.id, isSystemUser: false } });
    monthlyAmount = calculatePlanAmount(userCount) + marketingFee;
  }

  await client.update({
    clientName: clientName ?? client.clientName,
    mobile: mobile ?? client.mobile,
    email: email ?? client.email,
    address: address ?? client.address,
    salesPerson: salesPerson ?? client.salesPerson,
    marketingPersonPrice: marketingFee,
    monthlyAmount,
    active: active ?? client.active,
    allowBillCancellationRefund: allowBillCancellationRefund ?? client.allowBillCancellationRefund,
    qrPaymentRequired: qrPaymentRequired ?? client.qrPaymentRequired,
  });
  return res.json(client);
}

// GET /api/clients/marketing-persons  (any Chief-Admin type - used by the Sales Person picker)
async function listMarketingPersons(req, res) {
  const marketingRole = await Role.findOne({ where: { name: 'MARKETING' } });
  if (!marketingRole) return res.json([]);

  const users = await ChiefAdmin.findAll({
    include: [{ model: Role, where: { id: marketingRole.id }, through: { attributes: [] } }],
    attributes: ['id', 'username', 'name'],
    where: { active: true },
  });
  return res.json(users.map((u) => ({ id: u.id, username: u.username, name: u.name })));
}

// GET /api/clients/next-code  - lets the Create Client form show the code it
// will get before the client actually exists. Just a preview, not a
// reservation: the real one is (re)computed at creation time, so this can go
// briefly stale if another client is created in between, without causing a
// collision - createClient always generates its own code independently.
async function previewNextClientCode(req, res) {
  const clientCode = await generateClientCode('CHIEF_ADMIN');
  return res.json({ clientCode });
}

// Called once at server startup (see index.js) - createClient only auto-adds
// the "chiefadmin" support login for clients created from now on, so every
// client that already existed before this feature needs it added too. When
// SUPPORT_LOGIN_PASSWORD is configured, this also re-hashes every EXISTING
// support login's password to match it on every restart, so a client
// provisioned before that env var was set (or before it changed) still ends
// up in sync - not just newly-created clients. Left unset, existing support
// logins are never touched here, only missing ones get created (each with
// its own random password, same as before this env var existed).
async function backfillSystemUsers() {
  const adminRole = await Role.findOne({ where: { name: 'ADMIN' } });
  if (!adminRole) return;

  const clients = await Client.findAll({
    include: [{ model: ClientUser, where: { isSystemUser: true }, required: false }],
  });

  let created = 0;
  let resynced = 0;
  for (const client of clients) {
    const existing = (client.ClientUsers || [])[0];
    if (existing) {
      if (SUPPORT_LOGIN_PASSWORD) {
        await existing.update({ passwordHash: await bcrypt.hash(SUPPORT_LOGIN_PASSWORD, 10) });
        resynced += 1;
      }
      continue;
    }
    const existingUsername = await ClientUser.findOne({ where: { clientId: client.id, username: 'chiefadmin' } });
    if (existingUsername) continue; // a real staff user already happens to be named "chiefadmin" - don't collide
    const systemUser = await ClientUser.create({
      clientId: client.id, username: 'chiefadmin',
      passwordHash: await bcrypt.hash(SUPPORT_LOGIN_PASSWORD || generateReadablePassword(), 10),
      name: 'Chief Admin Support', isSystemUser: true,
    });
    await systemUser.setRoles([adminRole]);
    created += 1;
  }
  if (created > 0) console.log(`Created a Chief Admin support login for ${created} client(s).`);
  if (resynced > 0) console.log(`Chief Admin support login password synced to SUPPORT_LOGIN_PASSWORD for ${resynced} client(s).`);
}

module.exports = {
  createClient, listClients, getClient, updateClient, getClientRevenue, listMarketingPersons, createInitialSubscription, currentMonthRange,
  generateClientCode, previewNextClientCode, backfillSystemUsers, impersonateClient, mintSystemUserSession,
};

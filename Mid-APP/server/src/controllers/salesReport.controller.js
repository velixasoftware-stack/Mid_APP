const XLSX = require('xlsx');
const { Op } = require('sequelize');
const { Client, ChiefAdmin, Role, ClientPayment } = require('../models');
const { isMarketingOnly } = require('../middleware/auth.middleware');

// Filters by `column` falling within [from, to] (either end optional, `to`
// inclusive of its whole calendar day) - silently no-ops on missing/invalid
// dates, same convention used across the other Chief Admin/client reports.
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

/**
 * Aggregates every client's subscription value by the Sales/Marketing person
 * on record. `from`/`to`, when given, scope two different things to that
 * date range: which clients count as "onboarded" (Client.createdAt) and how
 * much was actually collected from their payments (ClientPayment.paymentDate)
 * - a client onboarded outside the range can still have in-range payments
 * counted, since collections don't stop just because acquisition did.
 */
// onlySalesPerson: a MARKETING-only user's username - limits the report
// (counts and revenue) to their own clients.
async function buildSalesReportData(from, to, onlySalesPerson = null) {
  const mine = (sp) => !onlySalesPerson || (sp || '').toLowerCase() === onlySalesPerson.toLowerCase();
  const marketingRole = await Role.findOne({ where: { name: 'MARKETING' } });
  const marketingUsers = marketingRole
    ? await ChiefAdmin.findAll({
        include: [{ model: Role, where: { id: marketingRole.id }, through: { attributes: [] } }],
      })
    : [];

  const summaryMap = new Map();
  for (const u of marketingUsers) {
    if (!mine(u.username)) continue;
    summaryMap.set(u.username, {
      salesPerson: u.username,
      name: u.name || u.username,
      clientCount: 0,
      totalMonthlyRevenue: 0,
      totalMarketingPersonPrice: 0,
      paymentsCollected: 0,
      paid: 0,
      pending: 0,
      expired: 0,
    });
  }

  const clients = await Client.findAll({
    where: dateRangeWhereOn('createdAt', from, to),
    order: [['createdAt', 'DESC']],
  });
  const details = [];

  for (const c of clients) {
    if (!c.salesPerson || !mine(c.salesPerson)) continue;
    if (!summaryMap.has(c.salesPerson)) {
      summaryMap.set(c.salesPerson, {
        salesPerson: c.salesPerson,
        name: c.salesPerson,
        clientCount: 0,
        totalMonthlyRevenue: 0,
        totalMarketingPersonPrice: 0,
        paymentsCollected: 0,
        paid: 0,
        pending: 0,
        expired: 0,
      });
    }
    const s = summaryMap.get(c.salesPerson);
    s.clientCount += 1;
    s.totalMonthlyRevenue += Number(c.monthlyAmount);
    s.totalMarketingPersonPrice += Number(c.marketingPersonPrice || 0);
    if (c.paymentStatus === 'PAID') s.paid += 1;
    else if (c.paymentStatus === 'PENDING') s.pending += 1;
    else if (c.paymentStatus === 'EXPIRED') s.expired += 1;

    details.push({
      salesPerson: c.salesPerson,
      clientCode: c.clientCode,
      clientName: c.clientName,
      marketingPersonPrice: Number(c.marketingPersonPrice || 0),
      monthlyAmount: Number(c.monthlyAmount),
      paymentStatus: c.paymentStatus,
      active: c.active,
      createdAt: c.createdAt,
    });
  }

  // Payments actually collected in the date range, attributed to each
  // client's salesPerson - independent of the onboarding-date filter above,
  // so a long-standing client's in-range payment still counts here even
  // though that client itself won't appear in `details` for an out-of-range
  // onboarding date.
  const payments = await ClientPayment.findAll({
    where: { status: 'PAID', ...dateRangeWhereOn('paymentDate', from, to) },
    include: [{ model: Client, attributes: ['salesPerson'] }],
  });
  for (const p of payments) {
    const salesPerson = p.Client?.salesPerson;
    if (!salesPerson || !mine(salesPerson)) continue;
    if (!summaryMap.has(salesPerson)) {
      summaryMap.set(salesPerson, {
        salesPerson, name: salesPerson, clientCount: 0, totalMonthlyRevenue: 0,
        totalMarketingPersonPrice: 0, paymentsCollected: 0, paid: 0, pending: 0, expired: 0,
      });
    }
    summaryMap.get(salesPerson).paymentsCollected += Number(p.amount);
  }

  // A MARKETING user's report covers only their own clients, and leaves out
  // the Total Monthly Revenue figure (not shown to the MARKETING role).
  const summary = [...summaryMap.values()];
  if (onlySalesPerson) for (const s of summary) delete s.totalMonthlyRevenue;
  return { summary, details, hideRevenue: !!onlySalesPerson };
}

// GET /api/chief-admin-users/sales-report?from=&to=
async function getSalesReport(req, res) {
  const { from, to } = req.query;
  const data = await buildSalesReportData(from, to, isMarketingOnly(req) ? req.user.username : null);
  return res.json(data);
}

// GET /api/chief-admin-users/sales-report/export?from=&to=
async function exportSalesReport(req, res) {
  const { from, to } = req.query;
  const { summary, details, hideRevenue } = await buildSalesReportData(from, to, isMarketingOnly(req) ? req.user.username : null);

  const summaryRows = summary.map((s) => ({
    'Sales Person': s.name,
    Username: s.salesPerson,
    'Clients Onboarded': s.clientCount,
    ...(hideRevenue ? {} : { 'Total Monthly Revenue': s.totalMonthlyRevenue }),
    'Total Marketing Person Price': s.totalMarketingPersonPrice,
    'Payments Collected': s.paymentsCollected,
    Paid: s.paid,
    Pending: s.pending,
    Expired: s.expired,
  }));
  const detailRows = details.map((d) => ({
    'Sales Person': d.salesPerson,
    'Client Code': d.clientCode,
    'Client Name': d.clientName,
    'Marketing Person Price': d.marketingPersonPrice,
    'Monthly Amount': d.monthlyAmount,
    'Payment Status': d.paymentStatus,
    Active: d.active ? 'Yes' : 'No',
    'Created On': new Date(d.createdAt).toISOString().slice(0, 10),
  }));

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(summaryRows), 'Summary');
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(detailRows), 'Details');
  const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename="marketing-sales-report.xlsx"');
  return res.send(buffer);
}

module.exports = { getSalesReport, exportSalesReport };

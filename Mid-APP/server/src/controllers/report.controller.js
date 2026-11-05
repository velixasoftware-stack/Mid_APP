const { Op } = require('sequelize');
const XLSX = require('xlsx');
const {
  Bill, BillItem, TestMaster, Sample, Report, Patient, Refund, BillDiscount, DuePayment, Result, ClientUser, ClientLocation,
} = require('../models');
const { locationWhere } = require('../utils/location');

/** Sum of everything refunded on a bill - already cancelled & paid back, so it must
 * never be counted as still "outstanding"/due from the patient. */
function refundedTotal(bill) {
  return (bill.Refunds || []).reduce((sum, r) => sum + Number(r.amount), 0);
}

/** Sum of every post-billing discount on a bill - also money already handed
 * back, not still owed, for the same reason as a refund. */
function postDiscountTotal(bill) {
  // A post-billing discount that was later cancelled was reversed - not given.
  return (bill.BillDiscounts || []).filter((d) => !d.cancelledAt).reduce((sum, d) => sum + Number(d.amount), 0);
}

/** What the patient still owes on a bill. Bill.dueAmount is kept current by
 * billing itself - net of the discount given at billing time, GST, partial and
 * due payments, refunds and post-billing discounts - so it's used as-is rather
 * than re-derived from totalAmount (which is before any discount). */
function dueTotal(bill) {
  return Number(bill.dueAmount) || 0;
}

// Every client is in India, but the server runs in UTC - day boundaries and
// day/month grouping are worked out in IST so a bill made at 1 AM lands on
// the right day.
const IST_OFFSET_MS = 330 * 60 * 1000;

function dateKey(date, groupBy) {
  const ist = new Date(new Date(date).getTime() + IST_OFFSET_MS).toISOString();
  return groupBy === 'month' ? ist.slice(0, 7) : ist.slice(0, 10);
}

/** A "YYYY-MM-DD" from the date pickers, as the start of that day in IST. */
function istDayStart(value) {
  return /^d{4}-d{2}-d{2}$/.test(String(value)) ? new Date(`${value}T00:00:00+05:30`) : new Date(value);
}

/**
 * A `to` date is inclusive of that whole calendar day, not just midnight.
 * Silently ignores an unparseable value (e.g. a stray "undefined" string
 * from a caller) instead of handing Postgres an invalid date and 500ing.
 */
function dateRangeWhere(from, to) {
  const fromDate = from ? istDayStart(from) : null;
  const toDate = to ? istDayStart(to) : null;
  const validFrom = fromDate && !Number.isNaN(fromDate.getTime()) ? fromDate : null;
  const validTo = toDate && !Number.isNaN(toDate.getTime()) ? toDate : null;
  if (!validFrom && !validTo) return {};

  const range = {};
  if (validFrom) range[Op.gte] = validFrom;
  if (validTo) {
    range[Op.lt] = new Date(validTo.getTime() + 24 * 60 * 60 * 1000); // up to the end of that day
  }
  return { createdAt: range };
}

/**
 * Which location's data a report covers. MANAGER and ADMIN (which includes
 * Chief Admin's support login) see every location, or the one picked in the
 * Location filter (?locationId=); anyone else only their own location.
 */
function reportLocationWhere(req) {
  const roles = req.user.roles || [];
  if (roles.includes('MANAGER') || roles.includes('ADMIN')) {
    const picked = Number.parseInt(req.query.locationId, 10);
    return Number.isInteger(picked) && picked > 0 ? { locationId: picked } : {};
  }
  return locationWhere(req);
}

/** The date range plus the location the report covers. */
function rangeFor(req, from, to) {
  return { ...dateRangeWhere(from, to), ...reportLocationWhere(req) };
}

/**
 * Bill totals per location for the period - one row per location (zeros
 * included), in the client's location order (Main first).
 */
async function buildLocationWise(req, range) {
  const { clientId } = req.user;
  const [bills, locations] = await Promise.all([
    Bill.findAll({ where: { clientId, ...range }, include: [Refund, BillDiscount] }),
    ClientLocation.findAll({ where: { clientId }, order: [['isMain', 'DESC'], ['name', 'ASC']] }),
  ]);
  const shown = range.locationId ? locations.filter((l) => l.id === range.locationId) : locations;
  const rows = new Map(shown.map((l) => [l.id, {
    locationId: l.id, location: l.name, isMain: l.isMain, bills: 0, gross: 0, discount: 0, tax: 0, net: 0, collected: 0, refunded: 0, outstanding: 0,
  }]));
  for (const b of bills) {
    if (!rows.has(b.locationId)) {
      rows.set(b.locationId, {
        locationId: b.locationId, location: 'No location', isMain: false, bills: 0, gross: 0, discount: 0, tax: 0, net: 0, collected: 0, refunded: 0, outstanding: 0,
      });
    }
    const r = rows.get(b.locationId);
    r.bills += 1;
    r.gross += Number(b.totalAmount);
    r.discount += Number(b.discount);
    r.tax += Number(b.taxAmount);
    r.net += Number(b.totalAmount) - Number(b.discount) + Number(b.taxAmount);
    r.collected += Number(b.paidAmount);
    r.refunded += refundedTotal(b);
    r.outstanding += dueTotal(b);
  }
  const round = (n) => Math.round(n * 100) / 100;
  return [...rows.values()].map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, typeof v === 'number' && k !== 'locationId' && k !== 'bills' ? round(v) : v])));
}

// GET /api/reports/location-wise?from=&to=&locationId=
async function locationWise(req, res) {
  const { from, to } = req.query;
  return res.json(await buildLocationWise(req, rangeFor(req, from, to)));
}

// GET /api/reports/transactions?from=&to=&groupBy=day|month
async function transactions(req, res) {
  const { clientId } = req.user;
  const { from, to, groupBy = 'day' } = req.query;

  const bills = await Bill.findAll({ where: { clientId, ...rangeFor(req, from, to) }, order: [['createdAt', 'ASC']] });
  const grouped = {};
  for (const bill of bills) {
    const key = dateKey(bill.createdAt, groupBy);
    if (!grouped[key]) grouped[key] = { period: key, billCount: 0, totalAmount: 0 };
    grouped[key].billCount += 1;
    grouped[key].totalAmount += Number(bill.totalAmount);
  }

  return res.json(Object.values(grouped));
}

// GET /api/reports/collection-summary?from=&to=
async function collectionSummary(req, res) {
  const { clientId } = req.user;
  const { from, to } = req.query;
  const bills = await Bill.findAll({ where: { clientId, ...rangeFor(req, from, to) }, include: [Refund, BillDiscount] });
  const totalBilled = bills.reduce((s, b) => s + Number(b.totalAmount), 0);
  const totalDiscount = bills.reduce((s, b) => s + Number(b.discount), 0);
  const totalTax = bills.reduce((s, b) => s + Number(b.taxAmount), 0);
  const totalCollected = bills.reduce((s, b) => s + Number(b.paidAmount), 0);
  const totalRefunded = bills.reduce((s, b) => s + refundedTotal(b), 0);
  const totalPostDiscount = bills.reduce((s, b) => s + postDiscountTotal(b), 0);

  return res.json({
    billCount: bills.length,
    totalBilled,
    totalCollected,
    totalRefunded,
    totalPostDiscount,
    totalDiscount,
    totalTax,
    // Gross (test prices) less the discount given at billing, plus GST.
    netAmount: totalBilled - totalDiscount + totalTax,
    outstanding: bills.reduce((s, b) => s + dueTotal(b), 0),
  });
}

// GET /api/reports/outstanding?from=&to=
async function outstanding(req, res) {
  const { clientId } = req.user;
  const { from, to } = req.query;
  const bills = await Bill.findAll({
    where: { clientId, ...rangeFor(req, from, to) },
    include: [Patient, Refund, BillDiscount],
    order: [['createdAt', 'DESC']],
  });
  const unpaid = bills
    .map((b) => ({
      billNo: b.billNo,
      patient: b.Patient?.name,
      totalAmount: b.totalAmount,
      discount: b.discount,
      taxAmount: b.taxAmount,
      paidAmount: b.paidAmount,
      refundedAmount: refundedTotal(b),
      postDiscountAmount: postDiscountTotal(b),
      outstanding: dueTotal(b),
      createdAt: b.createdAt,
    }))
    .filter((b) => b.outstanding > 0);
  return res.json(unpaid);
}

// GET /api/reports/lab-summary?from=&to=  (samples by status)
async function labSummary(req, res) {
  const { clientId } = req.user;
  const { from, to } = req.query;
  const samples = await Sample.findAll({ where: { clientId, ...rangeFor(req, from, to) } });
  const summary = samples.reduce((acc, s) => {
    acc[s.status] = (acc[s.status] || 0) + 1;
    return acc;
  }, {});
  return res.json({ total: samples.length, byStatus: summary });
}

// GET /api/reports/lab-details?from=&to=
async function labDetails(req, res) {
  const { clientId } = req.user;
  const { from, to } = req.query;
  const samples = await Sample.findAll({
    where: { clientId, ...rangeFor(req, from, to) },
    include: [
      { model: BillItem, include: [TestMaster, { model: Bill, include: [Patient] }] },
      { model: Report, include: [{ model: ClientUser, as: 'ReleasedByUser', attributes: ['username'] }] },
      { model: Result, attributes: ['createdAt', 'createdBy'] },
    ],
    order: [['createdAt', 'DESC']],
    limit: 200,
  });

  // Full audit trail per sample - who did each step and when. Samples from
  // before these columns existed fall back to what was recorded at the time
  // (e.g. result entry = when its results were first saved).
  return res.json(samples.map((s) => {
    const firstResult = [...(s.Results || [])].sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))[0];
    const r = s.Report;
    const bill = s.BillItem?.Bill;
    return {
      barcode: s.barcode,
      testCode: s.BillItem?.TestMaster?.testCode,
      testName: s.BillItem?.TestMaster?.testName,
      billNo: bill?.billNo,
      patientName: bill?.Patient?.name,
      umr: bill?.Patient?.umr,
      status: s.status,
      itemStatus: s.BillItem?.status,
      reportStatus: r?.status,
      registeredAt: s.createdAt,
      registeredBy: s.createdBy,
      collectedAt: s.collectedAt,
      collectedBy: s.collectedBy,
      resultEnteredAt: s.resultEnteredAt || firstResult?.createdAt || null,
      resultEnteredBy: s.resultEnteredBy || firstResult?.createdBy || null,
      verifiedAt: r?.verifiedAt,
      verifiedBy: r?.verifiedBy,
      releasedAt: r?.releasedAt,
      releasedBy: r?.releasedBy || r?.ReleasedByUser?.username || null,
      revokedAt: r?.revokedAt,
      revokedBy: r?.revokedBy,
      revokedReason: r?.revokedReason,
      lastUpdatedAt: s.updatedAt,
      lastUpdatedBy: s.updatedBy,
    };
  }));
}

// GET /api/reports/test-wise-revenue?from=&to=
async function testWiseRevenue(req, res) {
  const { clientId } = req.user;
  const { from, to } = req.query;
  const items = await BillItem.findAll({
    include: [
      { model: TestMaster },
      { model: Bill, where: { clientId, ...rangeFor(req, from, to) }, attributes: [] },
    ],
  });

  const grouped = {};
  for (const item of items) {
    const code = item.TestMaster.testCode;
    if (!grouped[code]) {
      grouped[code] = { testCode: code, testName: item.TestMaster.testName, count: 0, revenue: 0 };
    }
    grouped[code].count += 1;
    grouped[code].revenue += Number(item.price);
  }

  return res.json(Object.values(grouped));
}

/** "frontoffice (DEMO001)" -> "frontoffice" - the audit actor without the client code. */
function actorName(actor) {
  return String(actor || 'Unknown').replace(/\s*\([^)]*\)\s*$/, '') || 'Unknown';
}

/**
 * Money on the bills created in the range, split by payment mode and by the
 * user who did it. Each mode's Net equals what's left in hand, so the modes add
 * up to the Total Collected card: the payment taken at billing (under the
 * bill's mode), due payments collected later (under their own mode), minus
 * refunds and post-billing discounts handed back (under the mode they were
 * paid back in).
 */
async function buildPaymentBreakdown(clientId, range) {
  const bills = await Bill.findAll({ where: { clientId, ...range }, include: [Refund, BillDiscount, DuePayment] });

  const modes = new Map();
  const mode = (name) => {
    if (!modes.has(name)) modes.set(name, { mode: name, payments: 0, collected: 0, refunded: 0 });
    return modes.get(name);
  };
  const users = new Map();
  const user = (name) => {
    if (!users.has(name)) {
      users.set(name, { user: name, bills: 0, gross: 0, discount: 0, tax: 0, net: 0, collected: 0, refunded: 0, outstanding: 0 });
    }
    return users.get(name);
  };

  for (const b of bills) {
    const dues = b.DuePayments || [];
    const refunds = b.Refunds || [];
    const paidBack = (b.BillDiscounts || []).filter((d) => !d.cancelledAt)
      .map((d) => ({ ...d.get(), back: Number(d.amount) - Number(d.fromDueAmount || 0) }))
      .filter((d) => d.back > 0);
    // paidAmount is the running net; undo the later movements to get what was taken at billing.
    const atBilling = Number(b.paidAmount)
      - dues.reduce((s, d) => s + Number(d.amount), 0)
      + refunds.reduce((s, r) => s + Number(r.amount), 0)
      + paidBack.reduce((s, d) => s + d.back, 0);
    const billMode = b.paymentMode || (b.payorId ? 'Credit (Payor)' : 'Not specified');

    const u = user(actorName(b.createdBy));
    u.bills += 1;
    u.gross += Number(b.totalAmount);
    u.discount += Number(b.discount);
    u.tax += Number(b.taxAmount);
    u.net += Number(b.totalAmount) - Number(b.discount) + Number(b.taxAmount);
    u.outstanding += Number(b.dueAmount) || 0;

    if (atBilling > 0.004) {
      const m = mode(billMode); m.payments += 1; m.collected += atBilling;
      u.collected += atBilling;
    }
    for (const d of dues) {
      const m = mode(d.mode || 'Not specified'); m.payments += 1; m.collected += Number(d.amount);
      user(actorName(d.createdBy)).collected += Number(d.amount);
    }
    for (const r of refunds) {
      mode(r.mode || 'Not specified').refunded += Number(r.amount);
      user(actorName(r.createdBy)).refunded += Number(r.amount);
    }
    for (const d of paidBack) {
      mode(d.mode || 'Not specified').refunded += d.back;
      user(actorName(d.createdBy)).refunded += d.back;
    }
  }

  const round = (n) => Math.round(n * 100) / 100;
  const byMode = [...modes.values()]
    .map((m) => ({ ...m, collected: round(m.collected), refunded: round(m.refunded), net: round(m.collected - m.refunded) }))
    .sort((a, b) => b.net - a.net);
  const byUser = [...users.values()]
    .map((u) => Object.fromEntries(Object.entries(u).map(([k, v]) => [k, typeof v === 'number' ? round(v) : v])))
    .sort((a, b) => b.net - a.net || a.user.localeCompare(b.user));
  return { byMode, byUser };
}

// GET /api/reports/payment-breakdown?from=&to=
async function paymentBreakdown(req, res) {
  const { clientId } = req.user;
  const { from, to } = req.query;
  return res.json(await buildPaymentBreakdown(clientId, rangeFor(req, from, to)));
}

// GET /api/reports/report-status?from=&to=
async function reportStatusCounts(req, res) {
  const { clientId } = req.user;
  const { from, to } = req.query;
  const samples = await Sample.findAll({ where: { clientId, ...rangeFor(req, from, to) }, include: [Report] });
  const counts = { PENDING: 0, VERIFIED: 0, RELEASED: 0 };
  for (const s of samples) {
    if (s.Report) counts[s.Report.status] = (counts[s.Report.status] || 0) + 1;
  }
  return res.json(counts);
}

// GET /api/reports/export?from=&to=&groupBy=day|month  - everything on the
// Reports screen, as one workbook with a sheet per section.
async function exportReport(req, res) {
  const { clientId } = req.user;
  const { from, to, groupBy = 'day' } = req.query;
  const range = rangeFor(req, from, to);

  const [bills, testItems, samplesWithReport] = await Promise.all([
    Bill.findAll({ where: { clientId, ...range }, include: [Patient, Refund, BillDiscount], order: [['createdAt', 'ASC']] }),
    BillItem.findAll({ include: [TestMaster, { model: Bill, where: { clientId, ...range }, attributes: [] }] }),
    Sample.findAll({ where: { clientId, ...range }, include: [Report] }),
  ]);

  const grouped = {};
  for (const bill of bills) {
    const key = dateKey(bill.createdAt, groupBy);
    if (!grouped[key]) grouped[key] = { period: key, billCount: 0, totalAmount: 0 };
    grouped[key].billCount += 1;
    grouped[key].totalAmount += Number(bill.totalAmount);
  }
  const transactionRows = Object.values(grouped).map((t) => ({ Period: t.period, 'Bill Count': t.billCount, 'Total Amount': t.totalAmount }));

  const totalRefunded = bills.reduce((s, b) => s + refundedTotal(b), 0);
  const totalPostDiscount = bills.reduce((s, b) => s + postDiscountTotal(b), 0);
  const summaryRows = [{
    'From Date': from || 'All time',
    'To Date': to || 'All time',
    Bills: bills.length,
    'Gross Amount': bills.reduce((s, b) => s + Number(b.totalAmount), 0),
    Discount: bills.reduce((s, b) => s + Number(b.discount), 0),
    GST: bills.reduce((s, b) => s + Number(b.taxAmount), 0),
    'Net Amount': bills.reduce((s, b) => s + Number(b.totalAmount) - Number(b.discount) + Number(b.taxAmount), 0),
    'Total Collected': bills.reduce((s, b) => s + Number(b.paidAmount), 0),
    'Total Refunded': totalRefunded,
    'Total Post-Billing Discount': totalPostDiscount,
    Outstanding: bills.reduce((s, b) => s + dueTotal(b), 0),
  }];

  const outstandingRows = bills
    .map((b) => ({
      'Bill No': b.billNo,
      Patient: b.Patient?.name || '',
      'Total Amount': b.totalAmount,
      Discount: b.discount,
      GST: b.taxAmount,
      'Paid Amount': b.paidAmount,
      Refunded: refundedTotal(b),
      'Post-Billing Discount': postDiscountTotal(b),
      Outstanding: dueTotal(b),
    }))
    .filter((r) => r.Outstanding > 0);

  const revenueByTest = {};
  for (const item of testItems) {
    const code = item.TestMaster.testCode;
    if (!revenueByTest[code]) revenueByTest[code] = { testCode: code, testName: item.TestMaster.testName, count: 0, revenue: 0 };
    revenueByTest[code].count += 1;
    revenueByTest[code].revenue += Number(item.price);
  }
  const testRevenueRows = Object.values(revenueByTest).map((t) => ({
    'Test Code': t.testCode, 'Test Name': t.testName, Count: t.count, Revenue: t.revenue,
  }));

  const reportStatusRows = [{ PENDING: 0, VERIFIED: 0, RELEASED: 0 }];
  for (const s of samplesWithReport) {
    if (s.Report) reportStatusRows[0][s.Report.status] = (reportStatusRows[0][s.Report.status] || 0) + 1;
  }

  const labDetailsRows = await Sample.findAll({
    where: { clientId, ...range },
    include: [{ model: BillItem, include: [TestMaster] }, Report],
    order: [['createdAt', 'DESC']],
  }).then((samples) => samples.map((s) => ({
    Barcode: s.barcode,
    'Test Code': s.BillItem?.TestMaster?.testCode,
    'Test Name': s.BillItem?.TestMaster?.testName,
    'Sample Status': s.status,
    'Report Status': s.Report?.status || '',
    'Collected At': s.collectedAt,
  })));

  const { byMode, byUser } = await buildPaymentBreakdown(clientId, range);
  const locationRows = (await buildLocationWise(req, range)).map((r) => ({
    Location: r.location + (r.isMain ? ' (Main)' : ''), Bills: r.bills, Gross: r.gross, Discount: r.discount, GST: r.tax,
    Net: r.net, Collected: r.collected, Refunded: r.refunded, Outstanding: r.outstanding,
  }));
  const modeRows = byMode.map((m) => ({
    'Payment Mode': m.mode, Payments: m.payments, Collected: m.collected, 'Refunded / Paid Back': m.refunded, Net: m.net,
  }));
  const userRows = byUser.map((u) => ({
    User: u.user, Bills: u.bills, Gross: u.gross, Discount: u.discount, GST: u.tax, Net: u.net,
    Collected: u.collected, 'Refunded / Paid Back': u.refunded, Outstanding: u.outstanding,
  }));

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(summaryRows), 'Summary');
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(modeRows.length ? modeRows : [{ 'Payment Mode': 'No payments' }]), 'Payment Mode-wise');
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(userRows.length ? userRows : [{ User: 'No bills' }]), 'User-wise');
  if (locationRows.length) XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(locationRows), 'Location-wise');
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(transactionRows), 'Transactions');
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(testRevenueRows), 'Test-wise Revenue');
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(outstandingRows), 'Outstanding');
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(reportStatusRows), 'Report Status');
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(labDetailsRows), 'Lab Details');
  const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename="reports-export.xlsx"');
  return res.send(buffer);
}

module.exports = {
  transactions, collectionSummary, outstanding, labSummary, labDetails, testWiseRevenue, reportStatusCounts, exportReport,
  paymentBreakdown, locationWise,
};

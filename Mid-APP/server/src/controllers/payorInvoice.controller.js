const { Op } = require('sequelize');
const {
  sequelize, Payor, PayorInvoice, PayorInvoiceItem, PayorInvoiceCollection, Bill, BillItem, TestMaster, Patient,
} = require('../models');

function monthRange(month) {
  const [y, m] = month.split('-').map(Number);
  const from = new Date(y, m - 1, 1);
  const to = new Date(y, m, 0);
  return {
    fromDate: from.toISOString().slice(0, 10),
    toDate: to.toISOString().slice(0, 10),
  };
}

/** `week` is an ISO week string like "2026-W37" (what an <input type="week"> gives). */
function weekRange(week) {
  const [yearStr, weekStr] = week.split('-W');
  const year = Number(yearStr);
  const weekNum = Number(weekStr);

  const jan4 = new Date(year, 0, 4);
  const jan4Day = (jan4.getDay() + 6) % 7; // Monday = 0
  const week1Monday = new Date(jan4);
  week1Monday.setDate(jan4.getDate() - jan4Day);

  const monday = new Date(week1Monday);
  monday.setDate(week1Monday.getDate() + (weekNum - 1) * 7);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);

  return {
    fromDate: monday.toISOString().slice(0, 10),
    toDate: sunday.toISOString().slice(0, 10),
  };
}

// GET /api/payor-invoices/payors  (read-only, so a Manager can pick a payor to invoice)
async function listPayors(req, res) {
  const { clientId } = req.user;
  const payors = await Payor.findAll({ where: { clientId, active: true }, order: [['name', 'ASC']] });
  return res.json(payors);
}

// GET /api/payor-invoices/pending?payorId=X
// Every one of this payor's bills that hasn't been pulled into an invoice
// yet - i.e. what's currently sitting as due against this credit client,
// patient by patient - shown on the invoice generation screen so a Manager
// can see exactly who's included before generating anything.
async function listPendingBills(req, res) {
  const { clientId } = req.user;
  const { payorId } = req.query;
  if (!payorId) return res.status(400).json({ message: 'payorId is required' });

  const bills = await Bill.findAll({
    where: { clientId, payorId },
    include: [Patient, { model: BillItem, include: [TestMaster] }],
    order: [['walkInDate', 'ASC']],
  });

  const billIds = bills.map((b) => b.id);
  const invoicedItems = billIds.length
    ? await PayorInvoiceItem.findAll({ where: { billId: billIds }, attributes: ['billId'] })
    : [];
  const invoicedBillIds = new Set(invoicedItems.map((i) => i.billId));

  // Not yet invoiced, and still with at least one active (uncancelled) test.
  const pending = bills
    .filter((b) => !invoicedBillIds.has(b.id) && b.BillItems.some((i) => i.status !== 'CANCELLED'))
    .map((b) => ({
      billId: b.id,
      billNo: b.billNo,
      walkInDate: b.walkInDate,
      patientName: b.Patient?.name || '—',
      umr: b.Patient?.umr || '—',
      tests: b.BillItems.filter((i) => i.status !== 'CANCELLED').map((i) => i.TestMaster?.testName || 'Test').join(', '),
      amount: b.BillItems.filter((i) => i.status !== 'CANCELLED').reduce((s, i) => s + Number(i.price), 0),
    }));

  const total = pending.reduce((s, p) => s + p.amount, 0);
  return res.json({ pending, total, count: pending.length });
}

// POST /api/payor-invoices/generate  { payorId, month } or { payorId, week }
// month = 'YYYY-MM' for a MONTHLY-billed payor, week = 'YYYY-Www' (ISO week,
// what an <input type="week"> gives) for a WEEKLY-billed payor - whichever
// matches that payor's own billing cycle.
// Aggregates every BillItem billed under this Payor within that period into
// one invoice, snapshotting the client's standard price alongside the
// payor's negotiated price so the discount given is always visible, even if
// either price changes later.
async function generateInvoice(req, res) {
  const { clientId } = req.user;
  const { payorId, month, week } = req.body;
  if (!payorId) return res.status(400).json({ message: 'payorId is required' });

  const payor = await Payor.findOne({ where: { id: payorId, clientId } });
  if (!payor) return res.status(404).json({ message: 'Payor not found' });

  let period, fromDate, toDate;
  if (payor.billingCycle === 'WEEKLY') {
    if (!week) return res.status(400).json({ message: 'week is required for a weekly-billed payor' });
    period = week;
    ({ fromDate, toDate } = weekRange(week));
  } else {
    if (!month) return res.status(400).json({ message: 'month is required for a monthly-billed payor' });
    period = month;
    ({ fromDate, toDate } = monthRange(month));
  }

  // A period can have several invoices: each takes only the bills in the
  // period that aren't on an invoice yet (e.g. a bill billed after that
  // period's first invoice was generated goes on a second one).
  const periodBills = await Bill.findAll({
    where: { clientId, payorId, walkInDate: { [Op.between]: [fromDate, toDate] } },
    include: [Patient, { model: BillItem, include: [TestMaster] }],
  });
  const alreadyInvoiced = periodBills.length
    ? new Set((await PayorInvoiceItem.findAll({ where: { billId: periodBills.map((b) => b.id) }, attributes: ['billId'] })).map((i) => i.billId))
    : new Set();
  const bills = periodBills.filter((b) => !alreadyInvoiced.has(b.id));
  if (periodBills.length > 0 && bills.length === 0) {
    return res.status(400).json({ message: `Every bill for ${period} is already on an invoice for this payor` });
  }

  const items = [];
  for (const bill of bills) {
    // Cancelled tests aren't billed to the payor.
    for (const item of bill.BillItems.filter((i) => i.status !== 'CANCELLED')) {
      const original = Number(item.originalPrice ?? item.price);
      const assigned = Number(item.price);
      items.push({
        billId: bill.id,
        billItemId: item.id,
        testName: item.TestMaster?.testName || 'Test',
        patientName: bill.Patient?.name || '—',
        billNo: bill.billNo,
        originalPrice: original,
        assignedPrice: assigned,
        difference: original - assigned,
      });
    }
  }

  if (items.length === 0) {
    return res.status(400).json({ message: 'No billed tests found for this payor in the selected period' });
  }

  const totals = items.reduce((acc, i) => ({
    totalOriginal: acc.totalOriginal + i.originalPrice,
    totalAssigned: acc.totalAssigned + i.assignedPrice,
    totalDifference: acc.totalDifference + i.difference,
  }), { totalOriginal: 0, totalAssigned: 0, totalDifference: 0 });

  const invoice = await sequelize.transaction(async (t) => {
    const inv = await PayorInvoice.create({
      clientId, payorId, invoiceNo: `PINV-${Date.now()}`, month: period, fromDate, toDate, ...totals,
    }, { transaction: t });
    for (const i of items) {
      await PayorInvoiceItem.create({ payorInvoiceId: inv.id, ...i }, { transaction: t });
    }
    return inv;
  });

  return res.status(201).json(invoice);
}

// GET /api/payor-invoices  (optional ?payorId=)
// Includes a computed `due` per invoice - what's left to collect after both
// cash received (totalCollected) and any Other Deduction already recorded
// against it (totalDeduction) - so the list itself can be handed to a payor
// as a demand for payment before any collection has happened yet, without
// opening each invoice individually.
async function listInvoices(req, res) {
  const { clientId } = req.user;
  const where = { clientId };
  if (req.query.payorId) where.payorId = req.query.payorId;
  const invoices = await PayorInvoice.findAll({ where, include: [Payor], order: [['createdAt', 'DESC']] });

  const data = invoices.map((inv) => {
    const settled = Number(inv.totalCollected) + Number(inv.totalDeduction);
    return { ...inv.toJSON(), due: Math.max(0, Number(inv.totalAssigned) - settled) };
  });
  return res.json(data);
}

// GET /api/payor-invoices/:id
async function getInvoice(req, res) {
  const { clientId } = req.user;
  const invoice = await PayorInvoice.findOne({
    where: { id: req.params.id, clientId },
    include: [
      Payor,
      { model: PayorInvoiceItem },
      { model: PayorInvoiceCollection, separate: true, order: [['collectedAt', 'ASC']] },
    ],
  });
  if (!invoice) return res.status(404).json({ message: 'Invoice not found' });
  return res.json(invoice);
}

// POST /api/payor-invoices/:id/collections  { amount, paymentType, discount, remarks }
// A discount recorded here (e.g. a negotiated write-off) settles that part of
// the invoice the same as cash would, without counting as money collected.
async function addCollection(req, res) {
  const { clientId } = req.user;
  const invoice = await PayorInvoice.findOne({ where: { id: req.params.id, clientId } });
  if (!invoice) return res.status(404).json({ message: 'Invoice not found' });

  const { amount, paymentType, discount, remarks } = req.body;
  const amt = Number(amount);
  const disc = Number(discount) || 0;
  if (!amount || Number.isNaN(amt) || amt <= 0) {
    return res.status(400).json({ message: 'A positive amount is required' });
  }
  if (!['CASH', 'CARD', 'UPI'].includes(paymentType)) {
    return res.status(400).json({ message: 'paymentType must be CASH, CARD or UPI' });
  }
  if (disc > 0 && !remarks?.trim()) {
    return res.status(400).json({ message: 'Remarks are required when an Other Deduction amount is given' });
  }

  const collection = await PayorInvoiceCollection.create({
    payorInvoiceId: invoice.id, amount: amt, paymentType, discount: disc, remarks: remarks || null,
  });

  const newTotalCollected = Number(invoice.totalCollected) + amt;
  const newTotalDeduction = Number(invoice.totalDeduction) + disc;
  const newSettled = newTotalCollected + newTotalDeduction;

  await invoice.update({
    totalCollected: newTotalCollected,
    totalDeduction: newTotalDeduction,
    status: newSettled >= Number(invoice.totalAssigned)
      ? 'COLLECTED'
      : (newSettled > 0 ? 'PARTIALLY_COLLECTED' : 'PENDING'),
  });

  return res.status(201).json(collection);
}

module.exports = { listPayors, listPendingBills, generateInvoice, listInvoices, getInvoice, addCollection };

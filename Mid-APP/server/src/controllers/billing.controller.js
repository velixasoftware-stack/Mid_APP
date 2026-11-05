const crypto = require('crypto');
const { Op } = require('sequelize');
const {
  sequelize, Bill, BillItem, Refund, BillDiscount, DuePayment, ClientTestPrice, TestMaster, Sample, Report, Patient,
  ReferralDoctor, Client, Payor, PayorTestPrice, ClientTestShortName, Package, PayorInvoice, PayorInvoiceItem, ClientLocation,
} = require('../models');
const { locationWhere, sessionLocationId, applyLocationPrices } = require('../utils/location');
const { findOrCreatePatient } = require('./patient.controller');
const { findOrCreateDoctor } = require('./referralDoctor.controller');
const { sendEmail, sendWhatsApp } = require('../utils/notify');
const { fastingPostLunchConflict } = require('../utils/testType');
const { isBillableForClient } = require('../utils/testStatus');
const { itemCharges, cancellationSplit, withCharges, round2 } = require('../utils/billCharges');

/**
 * Next bill number for a client: its Client Code immediately followed by a
 * 5-digit running number kept separately per client, e.g. DEMO00100001,
 * DEMO00100002 ... and CLI000700001 for another client. Bills numbered in the
 * earlier hyphenated form (DEMO001-00001) still count, so the sequence just
 * continues. Must run inside the bill's transaction: the per-client advisory
 * lock makes two bills saved at the same moment wait for each other, so they
 * can never be given the same number. Old "INV-<timestamp>" bills are ignored.
 */
async function generateBillNo(clientId, transaction) {
  await sequelize.query('SELECT pg_advisory_xact_lock(:key)', { replacements: { key: 900000000 + Number(clientId) }, transaction });
  const client = await Client.findByPk(clientId, { attributes: ['clientCode'], transaction });
  // Bill numbers start with just the last 3 digits of the client code
  // (CLI0009 -> "009", so bill 1 is 00900001) - bills are always looked up
  // within their own client, so two clients ending alike never clash.
  const digits = (client?.clientCode || '').replace(/\D/g, '') || String(clientId);
  const code = digits.slice(-3).padStart(3, '0');
  const rows = await Bill.findAll({
    where: { clientId, billNo: { [Op.like]: `${code}%` } },
    attributes: ['billNo'],
    raw: true,
    transaction,
  });
  // Number part = whatever follows the client code (and the old optional
  // hyphen), counted only when it is all digits.
  const highest = rows.reduce((max, { billNo }) => {
    if (!billNo || !billNo.startsWith(code)) return max;
    const rest = billNo.slice(code.length).replace(/^-/, '');
    return /^\d{5,}$/.test(rest) ? Math.max(max, parseInt(rest, 10)) : max;
  }, 0);
  return `${code}${String(highest + 1).padStart(5, '0')}`;
}

function generateBarcode() {
  return `S${Date.now()}${crypto.randomBytes(2).toString('hex').toUpperCase()}`;
}

const billIncludes = [
  Patient,
  ReferralDoctor,
  Payor,
  { model: BillItem, include: [TestMaster, { model: Sample, include: [Report] }, Refund, { model: Package, attributes: ['id', 'packageCode', 'packageName', 'price'] }] },
  BillDiscount,
  DuePayment,
];

// POST /api/billing/bills
// Body: { patientId } OR { umr | mobile, name, age, gender, email, address } to
// find-or-register the patient in the same request; plus testIds, and
// optional referredDoctorName, walkInDate, discount, paymentMode, visitAddress,
// remarks, payorId. When payorId is given, each test is charged at that
// payor's negotiated price (falling back to the client's standard price if
// the payor has none set) instead of the walk-in patient paying the standard
// price directly - the standard price is still kept as BillItem.originalPrice
// so a monthly Payor invoice can show the discount given.
async function createBill(req, res) {
  const { clientId, id: userId } = req.user;
  const {
    patientId, umr, title, name, age, ageUnit, gender, mobile, email, address,
    testIds, packageIds, referredDoctorName, walkInDate, discount, paymentMode, visitAddress, transactionNumber, remarks, payorId,
    visitType, priority, amountCollected, gstPercent, barcodes,
  } = req.body;

  const testIdList = Array.isArray(testIds) ? testIds.map(Number).filter(Boolean) : [];
  const packageIdList = Array.isArray(packageIds) ? [...new Set(packageIds.map(Number).filter(Boolean))] : [];
  if (testIdList.length === 0 && packageIdList.length === 0) {
    return res.status(400).json({ message: 'Select at least one test or package' });
  }
  if ((Number(discount) || 0) > 0 && !remarks?.trim()) {
    return res.status(400).json({ message: 'Remarks are required when a discount is given' });
  }

  let patient;
  if (patientId) {
    patient = await Patient.findOne({ where: { id: patientId, clientId } });
    if (!patient) return res.status(404).json({ message: 'Patient not found' });
  } else {
    try {
      patient = await findOrCreatePatient(clientId, { umr, title, name, age, ageUnit, gender, mobile, email, address });
    } catch (err) {
      return res.status(400).json({ message: err.message });
    }
  }

  // The bill's location - its test prices are that location's (Main's unless it has its own).
  const locationId = await sessionLocationId(req);
  const prices = testIdList.length === 0 ? [] : await applyLocationPrices(await ClientTestPrice.findAll({
    where: { clientId, testId: testIdList },
    include: [TestMaster],
  }), locationId);
  if (prices.length !== testIdList.length) {
    return res.status(400).json({ message: 'Price not configured for one or more selected tests' });
  }
  const inactive = prices.filter((p) => !isBillableForClient(p, p.TestMaster));
  if (inactive.length) {
    return res.status(400).json({ message: `Inactive test(s) can't be billed: ${inactive.map((p) => p.TestMaster?.testName).join(', ')}` });
  }

  let payor = null;
  let payorPriceByTestId = new Map();
  if (payorId) {
    payor = await Payor.findOne({ where: { id: payorId, clientId } });
    if (!payor) return res.status(400).json({ message: 'Selected payor not found' });
    const payorPrices = await PayorTestPrice.findAll({ where: { payorId: payor.id, testId: testIdList } });
    payorPriceByTestId = new Map(payorPrices.map((p) => [p.testId, Number(p.price)]));
  }

  function chargedPriceFor(p) {
    if (payor && payorPriceByTestId.has(p.testId)) return payorPriceByTestId.get(p.testId);
    return Number(p.price);
  }

  const round2 = (n) => Math.round(n * 100) / 100;

  // One BillItem per test either way - a test picked on its own, or each test
  // of a picked package (so every test still gets its own sample and report).
  const lines = prices.map((p) => ({
    testId: p.testId, price: chargedPriceFor(p), originalPrice: Number(p.price), packageId: null,
  }));

  if (packageIdList.length) {
    const packages = await Package.findAll({
      where: { id: packageIdList, clientId, active: true },
      include: [TestMaster],
    });
    if (packages.length !== packageIdList.length) {
      return res.status(400).json({ message: 'One or more selected packages are not available' });
    }
    const pkgTestIds = packages.flatMap((pkg) => pkg.TestMasters.map((t) => t.id));
    const pkgTestPrices = await applyLocationPrices(await ClientTestPrice.findAll({ where: { clientId, testId: pkgTestIds } }), locationId);
    const stdPriceByTestId = new Map(pkgTestPrices.map((p) => [p.testId, p]));

    // A test may appear on a bill only once - not both on its own and in a
    // package, nor in two packages - or its sample/report would be duplicated.
    const onBill = new Map(prices.map((p) => [p.testId, 'selected on its own']));
    for (const pkg of packages) {
      for (const t of pkg.TestMasters) {
        // No price row of its own = billable only through the package, and only while Chief Admin has it Active.
        const row = stdPriceByTestId.get(t.id);
        if (row ? !isBillableForClient(row, t) : !t.active) {
          return res.status(400).json({ message: `Package ${pkg.packageName} contains an inactive test: ${t.testName}` });
        }
        if (onBill.has(t.id)) {
          return res.status(400).json({ message: `${t.testName} is in package ${pkg.packageName} and also ${onBill.get(t.id)} - remove one of them` });
        }
        onBill.set(t.id, `in package ${pkg.packageName}`);
      }
      if (pkg.TestMasters.length === 0) {
        return res.status(400).json({ message: `Package ${pkg.packageName} has no tests` });
      }

      // The package price is shared across its tests in proportion to their
      // standard prices (evenly when none are priced), and the last test
      // takes the rounding remainder - so the items add up to exactly the
      // package price, and test-wise revenue/refunds still work per test.
      const pkgPrice = Number(pkg.price);
      const weights = pkg.TestMasters.map((t) => Number(stdPriceByTestId.get(t.id)?.price) || 0);
      const weightSum = weights.reduce((s, w) => s + w, 0);
      let allocated = 0;
      pkg.TestMasters.forEach((t, i) => {
        const isLast = i === pkg.TestMasters.length - 1;
        const share = isLast
          ? round2(pkgPrice - allocated)
          : round2(weightSum > 0 ? pkgPrice * weights[i] / weightSum : pkgPrice / pkg.TestMasters.length);
        allocated = round2(allocated + share);
        lines.push({
          testId: t.id, price: share, originalPrice: weights[i] || share, packageId: pkg.id,
        });
      });
    }
  }

  const doctor = referredDoctorName ? await findOrCreateDoctor(clientId, referredDoctorName) : null;
  const discountAmount = Number(discount) || 0;
  const totalAmount = round2(lines.reduce((sum, l) => sum + l.price, 0));
  const taxableAmount = Math.max(0, totalAmount - discountAmount);
  const gstPercentNum = Number(gstPercent) || 0;
  const taxAmount = round2(taxableAmount * gstPercentNum / 100);
  const cgstAmount = round2(taxAmount / 2);
  const sgstAmount = round2(taxAmount - cgstAmount);
  const netPayable = taxableAmount + taxAmount;

  // A credit (Payor) bill is settled later via a Payor invoice - paidAmount
  // there has always meant "amount to invoice the payor", not cash collected
  // at the counter, so it's untouched by amountCollected/dueAmount below.
  // For every other bill, amountCollected lets less than the full net
  // payable be taken now (the rest becomes dueAmount, recovered later via
  // POST /bills/:id/due-payments) - a payment mode is only required when
  // something is actually being collected right now.
  let paidAmountNum = netPayable;
  let dueAmountNum = 0;
  if (!payorId) {
    paidAmountNum = (amountCollected === undefined || amountCollected === '' || amountCollected === null)
      ? netPayable
      : Math.max(0, Number(amountCollected) || 0);
    if (paidAmountNum > netPayable) {
      return res.status(400).json({ message: `Amount collected cannot exceed the net payable amount of ₹${netPayable.toFixed(2)}` });
    }
    dueAmountNum = netPayable - paidAmountNum;
    if (paidAmountNum > 0 && !paymentMode) {
      return res.status(400).json({ message: 'Payment Mode is required' });
    }
  }

  // A barcode entered at billing time (e.g. scanning a pre-printed tube
  // label) is optional - testIds without one still get an auto-generated
  // barcode and start PENDING_COLLECTION as before. Sample.barcode is
  // globally unique, so check for collisions up front with a clear message
  // instead of letting the transaction fail on a raw DB constraint error.
  const manualBarcodes = Object.entries(barcodes || {}).filter(([, v]) => v?.toString().trim());
  for (const [, code] of manualBarcodes) {
    const existing = await Sample.findOne({ where: { barcode: code.toString().trim() } });
    if (existing) return res.status(400).json({ message: `Barcode "${code}" is already in use by another sample` });
  }
  // A barcode marks its sample collected right now, so the Fasting/Post Lunch
  // rule applies here too - only one of the two may be scanned at billing.
  const scannedTestIds = lines.filter((l) => barcodes?.[l.testId]?.toString().trim()).map((l) => l.testId);
  if (scannedTestIds.length > 1) {
    const scannedTests = await TestMaster.findAll({ where: { id: scannedTestIds }, attributes: ['testName', 'testType'] });
    const conflict = fastingPostLunchConflict(scannedTests);
    if (conflict) return res.status(400).json({ message: `${conflict} Remove the barcode from one of them.` });
  }

  // Guard against duplicate bills from a rapid double-click / double-submit:
  // if the same patient already got a bill for the exact same set of tests
  // within the last 10 seconds, return that bill instead of creating another.
  const sortedTestIds = lines.map((l) => String(l.testId)).sort();
  const recentDuplicate = await Bill.findOne({
    where: { clientId, patientId: patient.id, createdAt: { [Op.gte]: new Date(Date.now() - 10000) } },
    include: [{ model: BillItem }],
    order: [['createdAt', 'DESC']],
  });
  if (recentDuplicate) {
    const existingTestIds = recentDuplicate.BillItems.map((bi) => String(bi.testId)).sort();
    if (existingTestIds.length === sortedTestIds.length && existingTestIds.every((v, i) => v === sortedTestIds[i])) {
      const full = await Bill.findOne({ where: { id: recentDuplicate.id, clientId }, include: billIncludes });
      return res.status(200).json(full);
    }
  }

  try {
    const result = await sequelize.transaction(async (t) => {
      const bill = await Bill.create({
        clientId, patientId: patient.id, createdByUserId: userId, locationId,
        referredDoctorId: doctor?.id || null,
        payorId: payor?.id || null,
        billNo: await generateBillNo(clientId, t),
        walkInDate: walkInDate || new Date().toISOString().slice(0, 10),
        visitType: visitType || 'WALK-IN',
        priority: priority || 'ROUTINE',
        totalAmount,
        discount: discountAmount,
        gstPercent: gstPercentNum,
        cgstAmount,
        sgstAmount,
        taxAmount,
        paidAmount: paidAmountNum,
        dueAmount: dueAmountNum,
        paymentMode: payor ? null : (paidAmountNum > 0 ? paymentMode : null),
        visitAddress: visitAddress || null,
        transactionNumber: transactionNumber || null,
        remarks: remarks || null,
      }, { transaction: t });

      for (const line of lines) {
        const billItem = await BillItem.create({
          billId: bill.id, testId: line.testId, price: line.price, originalPrice: line.originalPrice, packageId: line.packageId,
        }, { transaction: t });

        const manualBarcode = barcodes?.[line.testId]?.toString().trim();
        const sample = await Sample.create({
          clientId, billItemId: billItem.id, locationId,
          barcode: manualBarcode || generateBarcode(),
          // A barcode entered at billing time means the sample was already
          // physically labelled/collected right then - skip straight to
          // COLLECTED so it's ready for result entry instead of sitting in
          // the Pending Collection queue waiting for a separate Collect step.
          status: manualBarcode ? 'COLLECTED' : 'PENDING_COLLECTION',
          collectedAt: manualBarcode ? new Date() : null,
        }, { transaction: t });

        await Report.create({ sampleId: sample.id, status: 'PENDING' }, { transaction: t });
      }

      return bill;
    });

    return res.status(201).json(result);
  } catch (err) {
    return res.status(400).json({ message: err.message || 'Failed to create bill' });
  }
}

// GET /api/billing/bills/:id  (receipt/invoice view)
async function getBill(req, res) {
  const { clientId } = req.user;
  const bill = await Bill.findOne({ where: { id: req.params.id, clientId }, include: [...billIncludes, Client] });
  if (!bill) return res.status(404).json({ message: 'Bill not found' });
  // A credit bill's payment status comes from the payor invoice it was put
  // on: DUE until invoiced, then the invoice's PENDING / PARTIALLY_COLLECTED
  // / COLLECTED - shown on the receipt instead of "Paid by Patient".
  if (bill.payorId) {
    const invItem = await PayorInvoiceItem.findOne({ where: { billId: bill.id }, include: [PayorInvoice] });
    bill.setDataValue('payorStatus', invItem?.PayorInvoice?.status || 'DUE');
    bill.setDataValue('payorInvoiceNo', invItem?.PayorInvoice?.invoiceNo || null);
  }
  // Per-test charge after the bill discount, and the active tests' share of
  // the discount - see utils/billCharges.js.
  return res.json(withCharges(bill));
}

// POST /api/billing/bills/:billId/items  (Body: { testId })
// Adds one more test to an existing bill - e.g. re-adding a test that was
// cancelled by mistake (as a fresh line item; the cancelled one stays
// cancelled, for the audit trail), or one more test ordered mid-visit. The
// new test's price is added to the bill's total and, for a direct/self-pay
// bill, to its dueAmount - it isn't collected inline here, it's recovered
// via POST /bills/:billId/due-payments like any other due amount. A Payor
// bill instead adds the price straight to paidAmount, matching how a
// Payor's paidAmount has always meant "amount to invoice them", not cash
// collected from the patient.
async function addBillItem(req, res) {
  const { clientId } = req.user;
  const { billId } = req.params;
  const { testId } = req.body;
  if (!testId) return res.status(400).json({ message: 'testId is required' });

  const bill = await Bill.findOne({ where: { id: billId, clientId } });
  if (!bill) return res.status(404).json({ message: 'Bill not found' });

  const priceRow = await ClientTestPrice.findOne({ where: { clientId, testId }, include: [TestMaster] });
  if (!priceRow) return res.status(400).json({ message: 'Price not configured for this test' });
  await applyLocationPrices([priceRow], bill.locationId); // the price where this bill was made
  if (!isBillableForClient(priceRow, priceRow.TestMaster)) return res.status(400).json({ message: 'This test is inactive and can\'t be billed' });

  const existingActive = await BillItem.findOne({ where: { billId: bill.id, testId, status: 'ACTIVE' } });
  if (existingActive) return res.status(409).json({ message: 'This test is already active on this bill' });

  let price = Number(priceRow.price);
  if (bill.payorId) {
    const payorPrice = await PayorTestPrice.findOne({ where: { payorId: bill.payorId, testId } });
    if (payorPrice) price = Number(payorPrice.price);
  }

  const result = await sequelize.transaction(async (t) => {
    const billItem = await BillItem.create({
      billId: bill.id, testId, price, originalPrice: Number(priceRow.price),
    }, { transaction: t });

    const sample = await Sample.create({
      clientId, billItemId: billItem.id, locationId: bill.locationId, barcode: generateBarcode(), status: 'PENDING_COLLECTION',
    }, { transaction: t });
    await Report.create({ sampleId: sample.id, status: 'PENDING' }, { transaction: t });

    // This new test's own share of GST, at the bill's existing rate - keeps
    // the tax breakdown consistent with what was charged on every other test
    // already on this bill, rather than leaving it untaxed.
    const gstPercentNum = Number(bill.gstPercent) || 0;
    const round2 = (n) => Math.round(n * 100) / 100;
    const itemTax = round2(price * gstPercentNum / 100);
    const itemCgst = round2(itemTax / 2);
    const itemSgst = round2(itemTax - itemCgst);

    bill.totalAmount = Number(bill.totalAmount) + price;
    bill.cgstAmount = Number(bill.cgstAmount) + itemCgst;
    bill.sgstAmount = Number(bill.sgstAmount) + itemSgst;
    bill.taxAmount = Number(bill.taxAmount) + itemTax;
    if (bill.payorId) {
      bill.paidAmount = Number(bill.paidAmount) + price + itemTax;
    } else {
      bill.dueAmount = Number(bill.dueAmount) + price + itemTax;
    }
    await bill.save({ transaction: t });

    return billItem;
  });

  const full = await Bill.findOne({ where: { id: bill.id, clientId }, include: [...billIncludes, Client] });
  return res.status(201).json({ billItem: result, bill: full });
}

// POST /api/billing/bills/:billId/due-payments  (Body: { amount, mode, reference })
// Records a payment against whatever the bill's dueAmount currently is -
// left over from billing time, or added later (a test added post-billing,
// or a post-billing discount that was itself cancelled). Can be called more
// than once for partial recoveries, same pattern as Refund/BillDiscount.
async function recordDuePayment(req, res) {
  const { clientId } = req.user;
  const { billId } = req.params;
  const { amount, mode, reference } = req.body;

  const payAmount = Number(amount);
  if (!payAmount || payAmount <= 0) {
    return res.status(400).json({ message: 'A payment amount greater than 0 is required' });
  }
  if (!mode?.trim()) {
    return res.status(400).json({ message: 'Payment mode is required' });
  }

  const bill = await Bill.findOne({ where: { id: billId, clientId } });
  if (!bill) return res.status(404).json({ message: 'Bill not found' });
  if (payAmount > Number(bill.dueAmount)) {
    return res.status(400).json({ message: `Payment cannot exceed the due amount of ₹${Number(bill.dueAmount).toFixed(2)}` });
  }

  const result = await sequelize.transaction(async (t) => {
    const duePayment = await DuePayment.create({
      billId: bill.id, amount: payAmount, mode, reference: reference || null,
    }, { transaction: t });

    bill.dueAmount = Number(bill.dueAmount) - payAmount;
    bill.paidAmount = Number(bill.paidAmount) + payAmount;
    await bill.save({ transaction: t });

    return duePayment;
  });

  const full = await Bill.findOne({ where: { id: bill.id, clientId }, include: [...billIncludes, Client] });
  return res.status(201).json({ duePayment: result, bill: full });
}

// PUT /api/billing/bills/:billId/items/:itemId/cancel
// Body: { amount, mode, reason }  -- cancels one test within a bill and
// records a refund payout against it. Test-wise, not whole-bill: the rest of
// the bill's tests are untouched. `amount` can be less than the test's price
// (a partial refund), and further partial refunds can be recorded later up
// to whatever's left of the price.
async function cancelBillItem(req, res) {
  const { clientId } = req.user;
  const { billId, itemId } = req.params;
  const { amount, mode, reason } = req.body;

  const client = await Client.findByPk(clientId);
  if (!client?.allowBillCancellationRefund) {
    return res.status(403).json({ message: 'Cancellation & refund is not enabled for this clinic. Contact your administrator.' });
  }

  const refundAmount = round2(Number(amount) || 0);
  if (refundAmount < 0) {
    return res.status(400).json({ message: 'Refund amount cannot be negative' });
  }

  const bill = await Bill.findOne({ where: { id: billId, clientId } });
  if (!bill) return res.status(404).json({ message: 'Bill not found' });

  if (client.refundAllowedDays > 0 && bill.walkInDate) {
    const daysSinceBilling = Math.floor((Date.now() - new Date(bill.walkInDate).getTime()) / (1000 * 60 * 60 * 24));
    if (daysSinceBilling > client.refundAllowedDays) {
      return res.status(400).json({
        message: `Cancellation & refund is only allowed within ${client.refundAllowedDays} day(s) of billing. This bill was made ${daysSinceBilling} day(s) ago.`,
      });
    }
  }

  const billItem = await BillItem.findOne({
    where: { id: itemId, billId: bill.id },
    include: [{ model: Sample, include: [Report] }, Refund, TestMaster],
  });
  if (!billItem) return res.status(404).json({ message: 'Test not found on this bill' });
  if (billItem.status === 'CANCELLED') return res.status(400).json({ message: 'This test is already cancelled' });
  if (billItem.Sample?.status === 'RELEASED') {
    return res.status(400).json({ message: 'Cannot cancel a test whose report has already been released' });
  }

  // The test's actual charge is its share of the bill after the bill-level
  // discount (and GST) - not its list price. That charge first clears any
  // amount still due on the bill; only the rest, and never more than was
  // actually collected, can be refunded. See utils/billCharges.js.
  const allItems = await BillItem.findAll({ where: { billId: bill.id }, include: [Refund], order: [['id', 'ASC']] });
  const charge = itemCharges(bill, allItems).get(billItem.id);
  const { fromDue, maxRefund } = cancellationSplit(bill, charge);
  // The refund is exactly the test's amount after its discount share (less
  // whatever clears the bill's due) - no more, and no less: cancelling a
  // test always returns precisely what was paid for it.
  if (Math.abs(refundAmount - maxRefund) > 0.01) {
    return res.status(400).json({
      message: maxRefund > 0
        ? `Refund must be ₹${maxRefund.toFixed(2)} - this test's amount after its share of the bill discount${fromDue > 0 ? `, less the ₹${fromDue.toFixed(2)} that clears the amount still due` : ''}`
        : 'Nothing to refund for this test - its amount is covered by the amount still due on the bill',
    });
  }
  if (refundAmount > 0 && !mode?.trim()) {
    return res.status(400).json({ message: 'Refund payment mode is required' });
  }

  const result = await sequelize.transaction(async (t) => {
    const refund = refundAmount > 0
      ? await Refund.create({
        billId: bill.id, billItemId: billItem.id, amount: refundAmount, mode, reason: reason || null,
      }, { transaction: t })
      : null;

    billItem.status = 'CANCELLED';
    await billItem.save({ transaction: t });

    if (billItem.Sample) {
      billItem.Sample.status = 'CANCELLED';
      await billItem.Sample.save({ transaction: t });
    }

    // The cancelled test is no longer owed (its share comes off the due), and
    // paidAmount - net money actually retained - drops by the refund.
    bill.dueAmount = round2(Math.max(0, Number(bill.dueAmount) - fromDue));
    bill.paidAmount = round2(Math.max(0, Number(bill.paidAmount) - refundAmount));
    await bill.save({ transaction: t });

    return refund;
  });

  const full = await Bill.findOne({ where: { id: bill.id, clientId }, include: [...billIncludes, Client] });
  return res.status(201).json({ refund: result, bill: withCharges(full) });
}

// PUT /api/billing/bills/:billId/discount
// Body: { amount, mode, reason } -- applies an extra discount to a bill after
// it's already been created, separate from any discount given at billing
// time. No test is cancelled; it reduces what's still payable, coming off
// dueAmount first (so an unpaid patient simply owes less) and only touching
// paidAmount - handed back like a Refund - once dueAmount is exhausted.
async function applyPostBillingDiscount(req, res) {
  const { clientId } = req.user;
  const { billId } = req.params;
  const { amount, mode, reason } = req.body;

  const client = await Client.findByPk(clientId);
  if (!client?.allowPostBillingDiscount) {
    return res.status(403).json({ message: 'Post-billing discount is not enabled for this clinic. Contact your administrator.' });
  }

  const discountAmount = Number(amount);
  if (!discountAmount || discountAmount <= 0) {
    return res.status(400).json({ message: 'A discount amount greater than 0 is required' });
  }
  if (!mode?.trim()) {
    return res.status(400).json({ message: 'Payment mode is required' });
  }
  if (!reason?.trim()) {
    return res.status(400).json({ message: 'A reason is required for a post-billing discount' });
  }

  const bill = await Bill.findOne({ where: { id: billId, clientId } });
  if (!bill) return res.status(404).json({ message: 'Bill not found' });

  if (client.postDiscountAllowedDays > 0 && bill.walkInDate) {
    const daysSinceBilling = Math.floor((Date.now() - new Date(bill.walkInDate).getTime()) / (1000 * 60 * 60 * 24));
    if (daysSinceBilling > client.postDiscountAllowedDays) {
      return res.status(400).json({
        message: `Post-billing discount is only allowed within ${client.postDiscountAllowedDays} day(s) of billing. This bill was made ${daysSinceBilling} day(s) ago.`,
      });
    }
  }

  const paidAmount = Number(bill.paidAmount);
  const dueAmount = Number(bill.dueAmount);
  if (discountAmount > paidAmount + dueAmount) {
    return res.status(400).json({ message: `Discount cannot exceed ₹${(paidAmount + dueAmount).toFixed(2)} remaining on this bill` });
  }

  // A discount comes off whatever the patient still owes first - only the
  // leftover (once dueAmount hits zero) is handed back out of money already
  // collected. A bill with ₹300 due and a ₹300 discount should just clear
  // the due, not need money refunded.
  const fromDue = Math.min(discountAmount, dueAmount);
  const fromPaid = discountAmount - fromDue;

  const result = await sequelize.transaction(async (t) => {
    const billDiscount = await BillDiscount.create({ billId: bill.id, amount: discountAmount, fromDueAmount: fromDue, mode, reason }, { transaction: t });

    bill.discount = Number(bill.discount) + discountAmount;
    bill.dueAmount = Math.max(0, dueAmount - fromDue);
    bill.paidAmount = Math.max(0, paidAmount - fromPaid);
    await bill.save({ transaction: t });

    return billDiscount;
  });

  const full = await Bill.findOne({ where: { id: bill.id, clientId }, include: [...billIncludes, Client] });
  return res.status(201).json({ discount: result, bill: full });
}

// PUT /api/billing/bills/:billId/discounts/:discountId/cancel
// Reverses a post-billing discount that was given by mistake or needs to be
// clawed back. The row is kept, never deleted, and stamped with cancelledAt
// instead - so the audit trail shows a discount was given and then
// cancelled, not that it never happened. No money physically changes hands
// here (unlike giving the discount, which hands cash back), so the amount
// becomes dueAmount rather than being marked paid again.
async function cancelPostBillingDiscount(req, res) {
  const { clientId } = req.user;
  const { billId, discountId } = req.params;

  const bill = await Bill.findOne({ where: { id: billId, clientId } });
  if (!bill) return res.status(404).json({ message: 'Bill not found' });

  const billDiscount = await BillDiscount.findOne({ where: { id: discountId, billId: bill.id } });
  if (!billDiscount) return res.status(404).json({ message: 'Discount not found on this bill' });
  if (billDiscount.cancelledAt) return res.status(400).json({ message: 'This discount is already cancelled' });

  const result = await sequelize.transaction(async (t) => {
    billDiscount.cancelledAt = new Date();
    await billDiscount.save({ transaction: t });

    const fromDue = Number(billDiscount.fromDueAmount);
    const fromPaid = Number(billDiscount.amount) - fromDue;
    bill.discount = Math.max(0, Number(bill.discount) - Number(billDiscount.amount));
    // Restore each side exactly as it was taken - the due portion becomes
    // due again, and the paid portion becomes paid again (not also due),
    // since cancelling the discount doesn't mean cash was taken back.
    bill.dueAmount = Number(bill.dueAmount) + fromDue;
    bill.paidAmount = Number(bill.paidAmount) + fromPaid;
    await bill.save({ transaction: t });

    return billDiscount;
  });

  const full = await Bill.findOne({ where: { id: bill.id, clientId }, include: [...billIncludes, Client] });
  return res.status(200).json({ discount: result, bill: full });
}

// GET /api/billing/bills  (grid view - includes per-test status for each order)
async function listBills(req, res) {
  const { clientId } = req.user;
  const bills = await Bill.findAll({
    where: { clientId, ...locationWhere(req) },
    include: [...billIncludes, { model: ClientLocation, attributes: ['name'] }],
    order: [['createdAt', 'DESC']],
    limit: 200,
  });

  const data = bills.map((bill) => {
    // Per-test amount after the bill discount and its exact cancellation
    // refund (utils/billCharges.js) - what the Orders Cancel/Refund uses.
    const charged = withCharges(bill);
    const byId = new Map(charged.BillItems.map((i) => [i.id, i]));
    const b = bill;
    return {
    id: b.id,
    billNo: b.billNo,
    walkInDate: b.walkInDate,
    totalAmount: b.totalAmount,
    discount: b.discount,
    paidAmount: b.paidAmount,
    dueAmount: b.dueAmount,
    paymentMode: b.paymentMode,
    createdAt: b.createdAt,
    location: b.ClientLocation?.name || null,
    patient: b.Patient ? { id: b.Patient.id, umr: b.Patient.umr, title: b.Patient.title, name: b.Patient.name, mobile: b.Patient.mobile } : null,
    referredDoctor: b.ReferralDoctor?.name || null,
    payor: b.Payor?.name || null,
    payorId: b.payorId,
    postBillingDiscount: (b.BillDiscounts || []).filter((d) => !d.cancelledAt).reduce((sum, d) => sum + Number(d.amount), 0),
    discounts: (b.BillDiscounts || []).map((d) => ({
      id: d.id, amount: d.amount, mode: d.mode, reason: d.reason, cancelledAt: d.cancelledAt,
    })),
    tests: b.BillItems.map((item) => ({
      id: item.id,
      testName: item.TestMaster?.testName,
      price: item.price,
      itemStatus: item.status,
      status: item.Sample?.status,
      reportStatus: item.Sample?.Report?.status,
      refundedAmount: (item.Refunds || []).reduce((sum, r) => sum + Number(r.amount), 0),
      charge: byId.get(item.id)?.charge,
      maxRefund: byId.get(item.id)?.maxRefund,
      fromDue: byId.get(item.id)?.fromDue,
    })),
    };
  });

  return res.json(data);
}

// GET /api/billing/test-prices  (read-only, so Front Office can pick tests when
// billing - each row carries this client's own short name too, if they've set
// one, so searching by that shortcut name at billing time also finds the test)
async function listTestPrices(req, res) {
  const { clientId } = req.user;
  const [prices, shortNames] = await Promise.all([
    // Only tests this client can bill - see isBillableForClient.
    ClientTestPrice.findAll({ where: { clientId, active: true }, include: [TestMaster] }),
    ClientTestShortName.findAll({ where: { clientId } }),
  ]);
  const shortNameByTestId = new Map(shortNames.map((s) => [s.testId, s.shortName]));
  await applyLocationPrices(prices, await sessionLocationId(req)); // this location's prices
  const data = prices.filter((p) => isBillableForClient(p, p.TestMaster)).map((p) => ({ ...p.toJSON(), shortName: shortNameByTestId.get(p.testId) || null }));
  return res.json(data);
}

// GET /api/billing/packages  (read-only, so Front Office can bill a package)
// Only active packages whose every test is still active - for this client
// and in the shared Test Master - since an inactive test can't be billed.
async function listPackages(req, res) {
  const { clientId } = req.user;
  const [packages, prices] = await Promise.all([
    Package.findAll({ where: { clientId, active: true }, include: [TestMaster], order: [['packageName', 'ASC']] }),
    ClientTestPrice.findAll({ where: { clientId }, attributes: ['testId', 'active', 'overrideChiefInactive'] }),
  ]);
  const priceByTestId = new Map(prices.map((p) => [p.testId, p]));
  const billable = packages.filter((pkg) => pkg.TestMasters.length > 0
    && pkg.TestMasters.every((t) => {
      const row = priceByTestId.get(t.id);
      return row ? isBillableForClient(row, t) : t.active;
    }));
  return res.json(billable);
}

// GET /api/billing/payors  (read-only, so Front Office can attribute a bill to a payor)
async function listPayors(req, res) {
  const { clientId } = req.user;
  const payors = await Payor.findAll({ where: { clientId, active: true }, order: [['name', 'ASC']] });
  return res.json(payors);
}

// GET /api/billing/payors/:id/test-prices  (read-only, for live pricing while billing)
async function listPayorTestPrices(req, res) {
  const { clientId } = req.user;
  const payor = await Payor.findOne({ where: { id: req.params.id, clientId } });
  if (!payor) return res.status(404).json({ message: 'Payor not found' });
  const prices = await PayorTestPrice.findAll({ where: { payorId: payor.id } });
  return res.json(prices);
}

// GET /api/billing-settings  (current client's own cancellation/refund + post-discount toggles)
async function getBillingSettings(req, res) {
  const client = await Client.findByPk(req.user.clientId);
  return res.json({
    allowBillCancellationRefund: client.allowBillCancellationRefund,
    refundAllowedDays: client.refundAllowedDays,
    allowPostBillingDiscount: client.allowPostBillingDiscount,
    postDiscountAllowedDays: client.postDiscountAllowedDays,
    defaultGstPercent: client.defaultGstPercent,
  });
}

// PUT /api/billing-settings  (Admin/Manager self-service - no Chief Admin needed)
async function updateBillingSettings(req, res) {
  const client = await Client.findByPk(req.user.clientId);
  const { allowBillCancellationRefund, refundAllowedDays, allowPostBillingDiscount, postDiscountAllowedDays, defaultGstPercent } = req.body;

  const updates = {};
  if (allowBillCancellationRefund !== undefined) {
    if (typeof allowBillCancellationRefund !== 'boolean') {
      return res.status(400).json({ message: 'allowBillCancellationRefund must be true or false' });
    }
    updates.allowBillCancellationRefund = allowBillCancellationRefund;
  }
  if (refundAllowedDays !== undefined) {
    const days = Number(refundAllowedDays);
    if (!Number.isInteger(days) || days < 0) {
      return res.status(400).json({ message: 'refundAllowedDays must be a whole number of 0 or more' });
    }
    updates.refundAllowedDays = days;
  }
  if (allowPostBillingDiscount !== undefined) {
    if (typeof allowPostBillingDiscount !== 'boolean') {
      return res.status(400).json({ message: 'allowPostBillingDiscount must be true or false' });
    }
    updates.allowPostBillingDiscount = allowPostBillingDiscount;
  }
  if (postDiscountAllowedDays !== undefined) {
    const days = Number(postDiscountAllowedDays);
    if (!Number.isInteger(days) || days < 0) {
      return res.status(400).json({ message: 'postDiscountAllowedDays must be a whole number of 0 or more' });
    }
    updates.postDiscountAllowedDays = days;
  }
  if (defaultGstPercent !== undefined) {
    const pct = Number(defaultGstPercent);
    if (!Number.isFinite(pct) || pct < 0 || pct > 100) {
      return res.status(400).json({ message: 'defaultGstPercent must be a number between 0 and 100' });
    }
    updates.defaultGstPercent = pct;
  }

  await client.update(updates);
  return res.json({
    allowBillCancellationRefund: client.allowBillCancellationRefund,
    refundAllowedDays: client.refundAllowedDays,
    allowPostBillingDiscount: client.allowPostBillingDiscount,
    postDiscountAllowedDays: client.postDiscountAllowedDays,
    defaultGstPercent: client.defaultGstPercent,
  });
}

// POST /api/billing/bills/:billId/share  Body: { channel: 'whatsapp' | 'email', to? }
// `to` defaults to the patient's own mobile/email on file - only needed when
// sending somewhere else (e.g. a relative picking up the report). Sends a
// text/HTML summary, not a copy of the printed receipt - sendWhatsApp/
// sendEmail don't support attachments today (see utils/notify.js).
async function shareBill(req, res) {
  const { clientId } = req.user;
  const { channel, to } = req.body;
  if (channel !== 'whatsapp' && channel !== 'email') {
    return res.status(400).json({ message: 'channel must be "whatsapp" or "email"' });
  }

  const bill = await Bill.findOne({
    where: { id: req.params.billId, clientId },
    include: [Patient, Client, { model: BillItem, include: [TestMaster] }],
  });
  if (!bill) return res.status(404).json({ message: 'Bill not found' });

  const testLines = bill.BillItems.filter((i) => i.status !== 'CANCELLED')
    .map((i) => `- ${i.TestMaster.testName}: ₹${i.price}`).join('\n');
  const summary = `Bill No: ${bill.billNo}\nDate: ${bill.walkInDate}\n${testLines}\n\nTotal: ₹${bill.totalAmount}`
    + (Number(bill.taxAmount) > 0 ? `\nGST: ₹${bill.taxAmount}` : '')
    + `\nPaid: ₹${bill.paidAmount}` + (Number(bill.dueAmount) > 0 ? `\nDue: ₹${bill.dueAmount}` : '');

  if (channel === 'whatsapp') {
    const mobile = to || bill.Patient?.mobile;
    if (!mobile) return res.status(400).json({ message: "No mobile number on file for this patient - provide 'to'" });
    const result = await sendWhatsApp({
      to: mobile,
      message: `Hi ${bill.Patient?.name || ''}, here is your bill from ${bill.Client.clientName}.\n\n${summary}\n\nThank you!`,
    });
    return res.json(result);
  }

  const email = to || bill.Patient?.email;
  if (!email) return res.status(400).json({ message: "No email on file for this patient - provide 'to'" });
  const result = await sendEmail({
    to: email,
    subject: `Your bill from ${bill.Client.clientName} - ${bill.billNo}`,
    html: `<p>Hi ${bill.Patient?.name || ''},</p><p>Here is your bill from ${bill.Client.clientName}.</p><pre>${summary}</pre><p>Thank you!</p>`,
  });
  return res.json(result);
}

module.exports = {
  createBill, getBill, listBills, listTestPrices, listPackages, listPayors, listPayorTestPrices, cancelBillItem,
  applyPostBillingDiscount, cancelPostBillingDiscount, addBillItem, recordDuePayment,
  getBillingSettings, updateBillingSettings, shareBill,
};

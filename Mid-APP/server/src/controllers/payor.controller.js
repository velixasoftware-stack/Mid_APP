const XLSX = require('xlsx');
const { Payor, PayorTestPrice, TestMaster } = require('../models');

// GET /api/masters/payors
async function listPayors(req, res) {
  const { clientId } = req.user;
  const payors = await Payor.findAll({ where: { clientId }, order: [['name', 'ASC']] });
  return res.json(payors);
}

// POST /api/masters/payors
// Body: { name, contactPerson, mobile, email, address, billingCycle }
async function createPayor(req, res) {
  const { clientId } = req.user;
  const { name, contactPerson, mobile, email, address, billingCycle } = req.body;
  if (!name) return res.status(400).json({ message: 'Payor name is required' });
  if (billingCycle && !['MONTHLY', 'WEEKLY'].includes(billingCycle)) {
    return res.status(400).json({ message: 'billingCycle must be MONTHLY or WEEKLY' });
  }

  const existing = await Payor.findOne({ where: { clientId, name } });
  if (existing) return res.status(409).json({ message: 'A payor with this name already exists' });

  const payor = await Payor.create({
    clientId, name, contactPerson, mobile, email, address, billingCycle: billingCycle || 'MONTHLY',
  });
  return res.status(201).json(payor);
}

// PUT /api/masters/payors/:id
async function updatePayor(req, res) {
  const { clientId } = req.user;
  const payor = await Payor.findOne({ where: { id: req.params.id, clientId } });
  if (!payor) return res.status(404).json({ message: 'Payor not found' });

  const { name, contactPerson, mobile, email, address, active, billingCycle } = req.body;
  if (billingCycle && !['MONTHLY', 'WEEKLY'].includes(billingCycle)) {
    return res.status(400).json({ message: 'billingCycle must be MONTHLY or WEEKLY' });
  }
  await payor.update({
    name: name ?? payor.name,
    contactPerson: contactPerson ?? payor.contactPerson,
    mobile: mobile ?? payor.mobile,
    email: email ?? payor.email,
    address: address ?? payor.address,
    active: active ?? payor.active,
    billingCycle: billingCycle ?? payor.billingCycle,
  });
  return res.json(payor);
}

// GET /api/masters/payors/:id/test-prices
async function listPayorTestPrices(req, res) {
  const { clientId } = req.user;
  const payor = await Payor.findOne({ where: { id: req.params.id, clientId } });
  if (!payor) return res.status(404).json({ message: 'Payor not found' });

  const prices = await PayorTestPrice.findAll({ where: { payorId: payor.id }, include: [TestMaster] });
  return res.json(prices);
}

// PUT /api/masters/payors/:id/test-prices  { testId, price }
async function setPayorTestPrice(req, res) {
  const { clientId } = req.user;
  const payor = await Payor.findOne({ where: { id: req.params.id, clientId } });
  if (!payor) return res.status(404).json({ message: 'Payor not found' });

  const { testId, price } = req.body;
  if (!testId || price == null) return res.status(400).json({ message: 'testId and price are required' });

  const [record] = await PayorTestPrice.findOrCreate({ where: { payorId: payor.id, testId }, defaults: { price } });
  if (record.price != price) await record.update({ price });
  return res.json(record);
}

// GET /api/masters/payors/:id/test-prices/template  - every active test, pre-filled
// with this payor's current price where one is already set.
async function downloadPayorPriceTemplate(req, res) {
  const { clientId } = req.user;
  const payor = await Payor.findOne({ where: { id: req.params.id, clientId } });
  if (!payor) return res.status(404).json({ message: 'Payor not found' });

  const [tests, prices] = await Promise.all([
    TestMaster.findAll({ where: { active: true }, order: [['testCode', 'ASC']] }),
    PayorTestPrice.findAll({ where: { payorId: payor.id } }),
  ]);
  const priceByTestId = new Map(prices.map((p) => [p.testId, p.price]));

  const rows = tests.map((t) => ({
    TEST_CODE: t.testCode,
    TEST_NAME: t.testName,
    PRICE: priceByTestId.get(t.id) ?? '',
  }));

  const sheet = XLSX.utils.json_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, 'Payor Test Prices');
  const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="payor-test-price-template.xlsx"`);
  return res.send(buffer);
}

/** Parses an uploaded TEST_CODE/TEST_NAME/PRICE sheet and validates each row, without writing anything. */
async function previewPayorPriceUpload(req, res) {
  const { clientId } = req.user;
  const payor = await Payor.findOne({ where: { id: req.params.id, clientId } });
  if (!payor) return res.status(404).json({ message: 'Payor not found' });
  if (!req.file) return res.status(400).json({ message: 'Excel/CSV file is required' });

  const workbook = XLSX.read(req.file.buffer, { type: 'buffer' });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });

  const testCodes = [...new Set(rows.map((r) => String(r.TEST_CODE || '').trim()).filter(Boolean))];
  const tests = await TestMaster.findAll({ where: { testCode: testCodes } });
  const testByCode = new Map(tests.map((t) => [t.testCode, t]));

  const preview = rows.map((r, idx) => {
    const testCode = String(r.TEST_CODE || '').trim();
    const price = Number(r.PRICE);
    const errors = [];
    if (!testCode) errors.push('TEST_CODE is missing');
    else if (!testByCode.has(testCode)) errors.push(`Unknown TEST_CODE: ${testCode}`);
    if (Number.isNaN(price) || price < 0) errors.push('PRICE is invalid');

    return {
      row: idx + 2, // account for header row
      testCode,
      testName: r.TEST_NAME,
      price,
      valid: errors.length === 0,
      errors,
    };
  });

  return res.json({
    totalRows: preview.length,
    validRows: preview.filter((r) => r.valid).length,
    invalidRows: preview.filter((r) => !r.valid).length,
    preview,
  });
}

// POST /api/masters/payors/:id/test-prices/upload/commit  { rows: [{ testCode, price }] }
async function commitPayorPriceUpload(req, res) {
  const { clientId } = req.user;
  const payor = await Payor.findOne({ where: { id: req.params.id, clientId } });
  if (!payor) return res.status(404).json({ message: 'Payor not found' });

  const { rows } = req.body;
  if (!Array.isArray(rows) || rows.length === 0) {
    return res.status(400).json({ message: 'rows array is required' });
  }

  const results = { success: [], errors: [] };
  for (const row of rows) {
    const test = await TestMaster.findOne({ where: { testCode: row.testCode } });
    if (!test || Number.isNaN(Number(row.price))) {
      results.errors.push({ testCode: row.testCode, reason: 'Invalid test code or price' });
      continue;
    }
    const [record] = await PayorTestPrice.findOrCreate({
      where: { payorId: payor.id, testId: test.id },
      defaults: { price: row.price },
    });
    if (record.price != row.price) await record.update({ price: row.price });
    results.success.push({ testCode: row.testCode, price: row.price });
  }

  return res.json(results);
}

module.exports = {
  listPayors, createPayor, updatePayor, listPayorTestPrices, setPayorTestPrice,
  downloadPayorPriceTemplate, previewPayorPriceUpload, commitPayorPriceUpload,
};

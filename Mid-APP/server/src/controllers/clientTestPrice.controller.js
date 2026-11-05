const XLSX = require('xlsx');
const {
  ClientTestPrice, TestMaster, Client, ClientLocation, ClientLocationTestPrice,
} = require('../models');

function resolveClientId(req) {
  return req.params.clientId || req.user.clientId;
}

/**
 * The non-Main location whose own prices a client screen is working on
 * (?locationId= or body.locationId), or null for the client's Main prices.
 * A single-location user may only work on their own location.
 */
async function priceLocation(req, requestedLocationId) {
  if (req.params.clientId) return { location: null }; // Chief Admin edits Main prices only
  const requestedId = requestedLocationId || req.user.locationFilter; // a single-location user: their own
  if (!requestedId) return { location: null };
  const location = await ClientLocation.findOne({ where: { id: Number(requestedId) || 0, clientId: req.user.clientId } });
  if (!location) return { error: 'Location not found' };
  if (req.user.locationFilter && req.user.locationFilter !== location.id) {
    return { error: 'You can change prices only for your own location' };
  }
  return { location: location.isMain ? null : location };
}

// GET /api/clients/:clientId/test-prices  (or /api/masters/client-test-price for a client admin)
// ?locationId= shows that location's prices: its own where set (ownPrice),
// otherwise Main's - each row also carries mainPrice.
async function listPrices(req, res) {
  const { location, error } = await priceLocation(req, req.query.locationId);
  if (error) return res.status(400).json({ message: error });
  const prices = await ClientTestPrice.findAll({
    where: { clientId: resolveClientId(req) },
    include: [TestMaster],
  });
  if (location) {
    const own = await ClientLocationTestPrice.findAll({ where: { locationId: location.id } });
    const ownByTestId = new Map(own.map((p) => [p.testId, p.price]));
    for (const row of prices) {
      row.setDataValue('mainPrice', row.price);
      row.setDataValue('ownPrice', ownByTestId.has(row.testId));
      if (ownByTestId.has(row.testId)) row.setDataValue('price', ownByTestId.get(row.testId));
    }
  }
  return res.json(prices);
}

/** Sets (or, with price null, removes) a location's own price for a test. */
async function setLocationPrice(location, clientId, testId, price) {
  const main = await ClientTestPrice.findOne({ where: { clientId, testId } });
  if (!main) return { error: 'Set the Main location price for this test first' };
  if (price == null) {
    await ClientLocationTestPrice.destroy({ where: { locationId: location.id, testId } });
    return { record: { testId, price: main.price, ownPrice: false } };
  }
  const [record] = await ClientLocationTestPrice.findOrCreate({ where: { locationId: location.id, testId }, defaults: { price } });
  if (record.price != price) await record.update({ price });
  return { record: { testId, price: record.price, ownPrice: true } };
}

// PUT /api/clients/:clientId/test-prices  { testId, price }
// With locationId (a non-Main location): that location's own price, and
// resetToMain: true goes back to the Main price there.
async function setPrice(req, res) {
  const clientId = resolveClientId(req);
  const { testId, price, resetToMain } = req.body;
  const { location, error } = await priceLocation(req, req.body.locationId);
  if (error) return res.status(400).json({ message: error });
  if (location && testId && resetToMain) {
    const result = await setLocationPrice(location, clientId, testId, null);
    return result.error ? res.status(400).json({ message: result.error }) : res.json(result.record);
  }
  if (!testId || price == null) return res.status(400).json({ message: 'testId and price are required' });
  if (location) {
    const result = await setLocationPrice(location, clientId, testId, price);
    return result.error ? res.status(400).json({ message: result.error }) : res.json(result.record);
  }

  const [record] = await ClientTestPrice.findOrCreate({
    where: { clientId, testId },
    defaults: { price },
  });
  if (record.price != price) await record.update({ price });
  return res.json(record);
}

// GET /api/masters/client-test-price/template  - a ready-to-fill Excel sheet,
// pre-populated with every test and this client's current price (if any).
async function downloadTemplate(req, res) {
  const clientId = resolveClientId(req);
  const { location, error } = await priceLocation(req, req.query.locationId);
  if (error) return res.status(400).json({ message: error });
  const [tests, prices, own] = await Promise.all([
    TestMaster.findAll({ where: { active: true }, order: [['testCode', 'ASC']] }),
    ClientTestPrice.findAll({ where: { clientId } }),
    location ? ClientLocationTestPrice.findAll({ where: { locationId: location.id } }) : [],
  ]);
  const priceByTestId = new Map([...prices, ...own].map((p) => [p.testId, p.price])); // a location's own price wins

  const rows = tests.map((t) => ({
    TEST_CODE: t.testCode,
    TEST_NAME: t.testName,
    PRICE: priceByTestId.get(t.id) ?? '',
  }));

  const sheet = XLSX.utils.json_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, 'Test Prices');
  const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename="test-price-template.xlsx"');
  return res.send(buffer);
}

/**
 * Parses an uploaded Excel/CSV buffer of TEST_CODE, TEST_NAME, PRICE rows and
 * validates each against the global Test Master, without writing anything.
 * Step 1 of the Preview -> Validation -> Upload -> Success/Error flow.
 */
async function previewUpload(req, res) {
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

// POST /api/clients/:clientId/test-prices/upload/commit  { rows: [{ testCode, price }] }
async function commitUpload(req, res) {
  const clientId = resolveClientId(req);
  const { rows } = req.body;
  if (!Array.isArray(rows) || rows.length === 0) {
    return res.status(400).json({ message: 'rows array is required' });
  }

  const client = await Client.findByPk(clientId);
  if (!client) return res.status(404).json({ message: 'Client not found' });
  const { location, error } = await priceLocation(req, req.body.locationId);
  if (error) return res.status(400).json({ message: error });

  const results = { success: [], errors: [] };
  for (const row of rows) {
    const test = await TestMaster.findOne({ where: { testCode: row.testCode } });
    if (!test || Number.isNaN(Number(row.price))) {
      results.errors.push({ testCode: row.testCode, reason: 'Invalid test code or price' });
      continue;
    }
    if (location) {
      const result = await setLocationPrice(location, clientId, test.id, row.price);
      if (result.error) results.errors.push({ testCode: row.testCode, reason: result.error });
      else results.success.push({ testCode: row.testCode, price: row.price });
      continue;
    }
    const [record] = await ClientTestPrice.findOrCreate({
      where: { clientId, testId: test.id },
      defaults: { price: row.price },
    });
    if (record.price != row.price) await record.update({ price: row.price });
    results.success.push({ testCode: row.testCode, price: row.price });
  }

  return res.json(results);
}

// PUT /api/masters/client-test-price/:testId/status  { active }
// Switches a test on/off for this client's billing only - the shared Test
// Master and every other client are untouched.
async function setPriceStatus(req, res) {
  const clientId = resolveClientId(req);
  if (typeof req.body.active !== 'boolean') return res.status(400).json({ message: 'active (true/false) is required' });
  const record = await ClientTestPrice.findOne({ where: { clientId, testId: req.params.testId }, include: [TestMaster] });
  if (!record) return res.status(404).json({ message: 'This test has no price for your clinic yet - set a price first' });
  // Switching Active while Chief Admin has the test Inactive turns it on for
  // this clinic only (override); switching Inactive always clears that.
  await record.update({
    active: req.body.active,
    overrideChiefInactive: req.body.active && record.TestMaster?.active === false,
  });
  return res.json(record);
}

module.exports = { listPrices, setPrice, setPriceStatus, downloadTemplate, previewUpload, commitUpload };

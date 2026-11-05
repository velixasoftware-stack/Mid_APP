const XLSX = require('xlsx');
const { ClientTestShortName, TestMaster } = require('../models');

// GET /api/test-config/test-shortname
async function listShortNames(req, res) {
  const { clientId } = req.user;
  const shortNames = await ClientTestShortName.findAll({ where: { clientId }, include: [TestMaster] });
  return res.json(shortNames);
}

// PUT /api/test-config/test-shortname  { testId, shortName }
async function setShortName(req, res) {
  const { clientId } = req.user;
  const { testId, shortName } = req.body;
  if (!testId || !shortName?.trim()) return res.status(400).json({ message: 'testId and shortName are required' });

  const [record] = await ClientTestShortName.findOrCreate({
    where: { clientId, testId },
    defaults: { shortName: shortName.trim() },
  });
  if (record.shortName !== shortName.trim()) await record.update({ shortName: shortName.trim() });
  return res.json(record);
}

// GET /api/test-config/test-shortname/template  - pre-populated with every
// test and this client's current short name (if any), like the price template.
async function downloadTemplate(req, res) {
  const { clientId } = req.user;
  const [tests, shortNames] = await Promise.all([
    TestMaster.findAll({ where: { active: true }, order: [['testCode', 'ASC']] }),
    ClientTestShortName.findAll({ where: { clientId } }),
  ]);
  const shortNameByTestId = new Map(shortNames.map((s) => [s.testId, s.shortName]));

  const rows = tests.map((t) => ({
    TEST_CODE: t.testCode,
    TEST_NAME: t.testName,
    SHORT_NAME: shortNameByTestId.get(t.id) || '',
  }));

  const sheet = XLSX.utils.json_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, 'Test Short Names');
  const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename="test-shortname-template.xlsx"');
  return res.send(buffer);
}

/**
 * Parses an uploaded Excel/CSV of TEST_CODE, TEST_NAME, SHORT_NAME rows and
 * validates each against the Test Master, without writing anything yet.
 * Step 1 of Preview -> Validate -> Commit.
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
    const shortName = String(r.SHORT_NAME || '').trim();
    const errors = [];
    if (!testCode) errors.push('TEST_CODE is missing');
    else if (!testByCode.has(testCode)) errors.push(`Unknown TEST_CODE: ${testCode}`);
    if (!shortName) errors.push('SHORT_NAME is missing');

    return {
      row: idx + 2, // account for header row
      testCode,
      testName: r.TEST_NAME,
      shortName,
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

// POST /api/test-config/test-shortname/upload/commit  { rows: [{ testCode, shortName }] }
async function commitUpload(req, res) {
  const { clientId } = req.user;
  const { rows } = req.body;
  if (!Array.isArray(rows) || rows.length === 0) {
    return res.status(400).json({ message: 'rows array is required' });
  }

  const results = { success: [], errors: [] };
  for (const row of rows) {
    const test = await TestMaster.findOne({ where: { testCode: row.testCode } });
    const shortName = String(row.shortName || '').trim();
    if (!test || !shortName) {
      results.errors.push({ testCode: row.testCode, reason: 'Invalid test code or short name' });
      continue;
    }
    const [record] = await ClientTestShortName.findOrCreate({
      where: { clientId, testId: test.id },
      defaults: { shortName },
    });
    if (record.shortName !== shortName) await record.update({ shortName });
    results.success.push({ testCode: row.testCode, shortName });
  }

  return res.json(results);
}

module.exports = { listShortNames, setShortName, downloadTemplate, previewUpload, commitUpload };

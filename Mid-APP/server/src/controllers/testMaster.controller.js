const { Op } = require('sequelize');
const XLSX = require('xlsx');
const {
  sequelize, TestGroup, TestMaster, ParameterMaster, ParameterNormalRange, BillItem, Result,
  ClientTestPrice, ClientTestShortName, ClientTestSpecimen, PayorTestPrice, ClientParameterTrend, ClientHiddenParameter, ClientParameterLabel,
} = require('../models');
const { hiddenKey, hiddenParameterKeys } = require('../utils/hiddenParameters');
const { sortParameters } = require('../utils/parameterOrder');
const { normalizeTestType } = require('../utils/testType');
const { isBillableForClient } = require('../utils/testStatus');
const { applyClientRanges, ensureClientOverride, resetClientRanges, TEXT_KEYS } = require('../utils/clientRanges');

const GENDER_OPTIONS = ['All', 'Male', 'Female', 'Other'];
// A range row's gender: "All" (everyone) when blank; the older name "Any" is still accepted.
const rangeGender = (g) => {
  const v = String(g ?? '').trim();
  return !v || /^(any|all)$/i.test(v) ? 'All' : v;
};
const AGE_UNIT_OPTIONS = ['Years', 'Months', 'Days'];

// Chief Admin adds to the shared/universal catalog (clientId null, seen by
// everyone) exactly as before; a client-side user's own parameter is scoped
// to their client only and never shows up for anyone else.
function requesterClientId(req) {
  return req.user?.type === 'CLIENT_USER' ? req.user.clientId : null;
}

// Parameter codes are always system-generated, never typed in - one uniform
// "PARM" prefix plus a zero-padded number, shared across every parameter
// regardless of its name (not a per-name prefix like "HEMO001"/"GLUC001",
// which made every parameter's own count effectively restart at 001). The
// sequence number is the highest one already in use across every existing
// parameter code, the same shared-sequence approach used for Client Code.
// Used identically from the client-side Test Parameters screen, the Chief
// Admin Test Master screen, and the Excel bulk upload.
async function generateParameterCode() {
  const prefix = 'PARM';
  const existing = await ParameterMaster.findAll({ attributes: ['parameterCode'] });
  let maxN = 0;
  for (const p of existing) {
    const match = p.parameterCode?.match(/(\d+)/);
    if (match) maxN = Math.max(maxN, parseInt(match[1], 10));
  }

  let n = maxN + 1;
  let code = `${prefix}${String(n).padStart(3, '0')}`;
  while (await ParameterMaster.findOne({ where: { parameterCode: code } })) {
    n += 1;
    code = `${prefix}${String(n).padStart(3, '0')}`;
  }
  return code;
}

// PUT .../parameters/:parameterId/normal-range-text  { normalRangeText?, normalRangeTextMale?, normalRangeTextFemale? }
// The reference range printed on the report for this parameter (blank =
// print low - high again). A client may only change its own parameters;
// Chief Admin changes the universal ones (shared by every client).
async function setNormalRangeText(req, res) {
  const clientId = requesterClientId(req);
  const parameter = await ParameterMaster.findByPk(req.params.parameterId);
  if (!parameter) return res.status(404).json({ message: 'Parameter not found' });
  // Only the boxes sent are changed; a blank box clears that version.
  const updates = {};
  for (const key of TEXT_KEYS) {
    if (key in req.body) updates[key] = req.body[key]?.toString().trim() || null;
  }
  // A clinic editing a universal parameter edits its own copy (made now if
  // needed) - never the shared text other clinics use.
  if (clientId && parameter.clientId == null) {
    const result = await sequelize.transaction(async (transaction) => {
      const { override } = await ensureClientOverride(clientId, parameter, transaction);
      await override.update(updates, { transaction });
      return { ...parameter.toJSON(), ...Object.fromEntries(TEXT_KEYS.map((k) => [k, override[k]])), customizedForClient: true };
    });
    return res.json(result);
  }
  if ((parameter.clientId ?? null) !== (clientId ?? null)) {
    return res.status(403).json({ message: 'This parameter belongs to a client - it can only be changed from that client' });
  }
  await parameter.update(updates);
  return res.json(parameter);
}

// DELETE .../parameters/:parameterId/customization  (clinic only)
// Drops the clinic's own copy of a universal parameter's ranges and printed
// text - it follows Chief Admin's ranges again (including later changes).
async function resetParameterRanges(req, res) {
  const clientId = requesterClientId(req);
  if (!clientId) return res.status(400).json({ message: 'Only a clinic has its own copy to reset' });
  const parameter = await ParameterMaster.findByPk(req.params.parameterId);
  if (!parameter) return res.status(404).json({ message: 'Parameter not found' });
  await sequelize.transaction((transaction) => resetClientRanges(clientId, parameter.id, transaction));
  return res.json({ message: 'Now using Chief Admin\'s normal ranges' });
}

// PUT /api/test-config/parameters/:parameterId/trend  { showTrend }
// Client-only: whether this parameter's trend prints on this client's patient
// reports. Stored per parameter, so it applies on every test it's mapped to.
async function setParameterTrend(req, res) {
  const clientId = requesterClientId(req);
  if (!clientId) return res.status(400).json({ message: 'Trend settings are per client' });
  if (typeof req.body.showTrend !== 'boolean') return res.status(400).json({ message: 'showTrend (true/false) is required' });

  // Only a parameter this client can see: universal, or its own.
  const parameter = await ParameterMaster.findOne({
    where: { id: req.params.parameterId, [Op.or]: [{ clientId: null }, { clientId }] },
  });
  if (!parameter) return res.status(404).json({ message: 'Parameter not found' });

  if (req.body.showTrend) {
    await ClientParameterTrend.findOrCreate({ where: { clientId, parameterId: parameter.id } });
  } else {
    await ClientParameterTrend.destroy({ where: { clientId, parameterId: parameter.id } });
  }
  return res.json({ parameterId: parameter.id, showTrend: req.body.showTrend });
}

// GET /api/admin/masters/groups  (Chief Admin)
// GET /api/masters/groups        (client MASTER_MANAGER - read only, so a
// client's own new test is filed under one of Chief Admin's groups)
async function listTestGroups(req, res) {
  return res.json(await allGroupNames());
}

// Every service group: the explicitly-created TestGroup rows plus any older
// group name that only exists as a test's category (from before groups were
// their own table) - the same merged list Chief Admin's Test Master shows.
// Case-insensitive de-dupe, keeping the TestGroup spelling where both exist.
async function allGroupNames() {
  const groups = await TestGroup.findAll({ attributes: ['id', 'name'] });
  const categories = await TestMaster.findAll({
    attributes: [[sequelize.fn('DISTINCT', sequelize.col('category')), 'category']],
    where: { category: { [Op.and]: [{ [Op.ne]: null }, { [Op.ne]: '' }] } },
    raw: true,
  });
  const byKey = new Map();
  for (const g of groups) byKey.set(g.name.trim().toLowerCase(), { id: g.id, name: g.name });
  for (const { category } of categories) {
    const key = category.trim().toLowerCase();
    if (key && !byKey.has(key)) byKey.set(key, { id: null, name: category.trim() });
  }
  return [...byKey.values()].sort((a, b) => a.name.localeCompare(b.name));
}

// POST /api/admin/masters/groups  { name }  (Chief Admin only)
async function createTestGroup(req, res) {
  const name = req.body.name?.trim();
  if (!name) return res.status(400).json({ message: 'Group name is required' });

  const existing = await TestGroup.findOne({ where: { name: { [Op.iLike]: name } } });
  if (existing) return res.status(200).json(existing); // resubmit-safe, same as parameter creation

  const group = await TestGroup.create({ name });
  return res.status(201).json(group);
}

// POST /api/masters/tests
async function createTest(req, res) {
  const { testCode, testName, category, sampleType, interpretation, parameters } = req.body;
  if (!testCode || !testName) {
    return res.status(400).json({ message: 'testCode and testName are required' });
  }
  const testType = normalizeTestType(req.body.testType);
  if (testType === null) return res.status(400).json({ message: 'Test Type must be Regular, Fasting or Post Lunch' });

  // A client's new test must be filed under one of Chief Admin's service
  // groups (Chief Admin itself may still leave a test Uncategorized).
  let groupName = category;
  if (requesterClientId(req)) {
    const wanted = category?.trim().toLowerCase();
    const group = wanted && (await allGroupNames()).find((g) => g.name.toLowerCase() === wanted);
    if (!group) return res.status(400).json({ message: 'Select a Service Group for the test' });
    groupName = group.name;
  }

  const existing = await TestMaster.findOne({ where: { testCode } });
  if (existing) return res.status(409).json({ message: 'Test Code already exists' });

  const test = await TestMaster.create({ testCode, testName, category: groupName, sampleType, testType: testType || 'REGULAR', interpretation });

  if (Array.isArray(parameters)) {
    const clientId = requesterClientId(req);
    for (const p of parameters) {
      await ParameterMaster.create({
        testId: test.id,
        clientId,
        parameterCode: await generateParameterCode(),
        parameterName: p.parameterName,
        unit: p.unit,
        method: p.method,
        normalRangeLow: p.normalRangeLow,
        normalRangeHigh: p.normalRangeHigh,
        isInterpretation: !!p.isInterpretation,
      });
    }
  }

  return res.status(201).json(test);
}

// GET /api/masters/tests
// A client sees every universal parameter plus whatever parameters they've
// added for themselves; Chief Admin (no client context) sees only the
// universal catalog - matching what it managed before this feature existed.
// Each test's ParameterMasters list is its own (home) parameters plus any
// parameter *assigned* to it from elsewhere - merged into one array so
// nothing else in the app needs to know about the distinction.
async function listTests(req, res) {
  const clientId = requesterClientId(req);
  const paramWhere = clientId ? { active: true, [Op.or]: [{ clientId: null }, { clientId }] } : { active: true, clientId: null };

  const tests = await TestMaster.findAll({
    include: [
      // Ranges are attached below per clinic (applyClientRanges), not included here.
      { model: ParameterMaster, where: paramWhere, required: false },
      { model: ParameterMaster, as: 'AssignedParameters', where: paramWhere, required: false, through: { attributes: [] } },
    ],
    order: [['testCode', 'ASC']],
  });

  // This client's "show trend on the report" choice, per parameter.
  const trended = clientId
    ? new Set((await ClientParameterTrend.findAll({ where: { clientId }, attributes: ['parameterId'] })).map((r) => r.parameterId))
    : null;
  // This client's own Active/Inactive per test (and any override of Chief
  // Admin's Inactive) - see utils/testStatus.js.
  const priceRowByTestId = clientId
    ? new Map((await ClientTestPrice.findAll({ where: { clientId }, attributes: ['testId', 'active', 'overrideChiefInactive'] }))
      .map((r) => [r.testId, r]))
    : null;
  // This client's own specimen per test (Chief Admin's sampleType otherwise).
  const specimenByTestId = clientId
    ? new Map((await ClientTestSpecimen.findAll({ where: { clientId }, attributes: ['testId', 'sampleType'] })).map((r) => [r.testId, r.sampleType]))
    : null;
  // Universal parameters this client removed from a test for itself only.
  const hidden = await hiddenParameterKeys(clientId);

  const result = tests.map((t) => {
    const json = t.toJSON();
    const owned = json.ParameterMasters || [];
    const ownedIds = new Set(owned.map((p) => p.id));
    const assigned = (json.AssignedParameters || [])
      .filter((p) => !ownedIds.has(p.id))
      .map((p) => ({ ...p, isAssigned: true }));
    const all = sortParameters([...owned, ...assigned]);
    json.ParameterMasters = all.filter((p) => !hidden.has(hiddenKey(t.id, p.id)));
    // Listed separately (for a Restore button), only for a client.
    if (clientId) {
      json.HiddenParameters = all.filter((p) => hidden.has(hiddenKey(t.id, p.id)))
        .map((p) => ({ id: p.id, parameterName: p.parameterName, unit: p.unit }));
    }
    if (trended) json.ParameterMasters = json.ParameterMasters.map((p) => ({ ...p, showTrend: trended.has(p.id) }));
    if (priceRowByTestId) {
      // No price row yet = follows Chief Admin's switch alone.
      const row = priceRowByTestId.get(t.id);
      json.activeForClient = row ? isBillableForClient(row, t) : t.active !== false;
    }
    if (specimenByTestId) json.clientSampleType = specimenByTestId.get(t.id) || null;
    delete json.AssignedParameters;
    return json;
  });
  // Each parameter's ranges + printed text as this requester uses them: Chief
  // Admin sees the shared rows; a clinic sees its own copy where it has
  // customised a universal parameter (customizedForClient), else the shared.
  await applyClientRanges(result.flatMap((t) => t.ParameterMasters), clientId);
  return res.json(result);
}

// PUT /api/test-config/tests/:testId/specimen  Body: { sampleType }
// The logged-in client's own specimen for a test, printed on its reports
// instead of Chief Admin's - never changes Test Master or other clients.
// Empty = remove it (back to Chief Admin's sample type).
async function setClientSpecimen(req, res) {
  const clientId = requesterClientId(req);
  if (!clientId) return res.status(403).json({ message: 'Only a client can set its own specimen' });
  const test = await TestMaster.findByPk(req.params.testId, { attributes: ['id', 'sampleType'] });
  if (!test) return res.status(404).json({ message: 'Test not found' });
  const sampleType = req.body.sampleType?.toString().trim() || '';
  if (sampleType.length > 100) return res.status(400).json({ message: 'Specimen cannot be more than 100 characters' });

  if (!sampleType) {
    await ClientTestSpecimen.destroy({ where: { clientId, testId: test.id } });
    return res.json({ testId: test.id, clientSampleType: null, sampleType: test.sampleType });
  }
  const existing = await ClientTestSpecimen.findOne({ where: { clientId, testId: test.id } });
  if (existing) await existing.update({ sampleType });
  else await ClientTestSpecimen.create({ clientId, testId: test.id, sampleType });
  return res.json({ testId: test.id, clientSampleType: sampleType, sampleType: test.sampleType });
}

// PUT /api/masters/tests/:id
async function updateTest(req, res) {
  const test = await TestMaster.findByPk(req.params.id);
  if (!test) return res.status(404).json({ message: 'Test not found' });
  const { testName, category, sampleType, interpretation } = req.body;
  const testType = normalizeTestType(req.body.testType);
  if (testType === null) return res.status(400).json({ message: 'Test Type must be Regular, Fasting or Post Lunch' });
  // Test Master's own active flag switches the test off for every client, so
  // only Chief Admin may change it - a client switches a test off for itself
  // only, via its price row (see clientTestPrice.setPriceStatus).
  const active = requesterClientId(req) ? undefined : req.body.active;
  await test.update({
    testName: testName ?? test.testName,
    category: category !== undefined ? category : test.category,
    sampleType: sampleType !== undefined ? sampleType : test.sampleType,
    testType: testType ?? test.testType,
    interpretation: interpretation !== undefined ? interpretation : test.interpretation,
    active: active ?? test.active,
  });
  return res.json(test);
}

// Everything that references a test, so Chief Admin sees what a delete would
// remove (master data) and what would block it (patient history).
async function collectTestUsage(test) {
  const ownParams = await ParameterMaster.findAll({ where: { testId: test.id }, attributes: ['id'] });
  const ownParamIds = ownParams.map((p) => p.id);
  const [[{ packages }]] = await sequelize.query(
    'SELECT COUNT(*)::int AS packages FROM package_test WHERE "testId" = :testId',
    { replacements: { testId: test.id } },
  );
  // This test's own parameters that other tests also use (assigned there) -
  // deleting them would silently strip those other tests too.
  const sharedTo = ownParamIds.length === 0 ? [] : (await sequelize.query(
    `SELECT DISTINCT t."testName" FROM test_parameter_link l JOIN test_master t ON t.id = l."testId"
      WHERE l."parameterId" IN (:ids) AND l."testId" <> :testId`,
    { replacements: { ids: ownParamIds, testId: test.id } },
  ))[0].map((r) => r.testName);

  return {
    ownParamIds,
    bills: await BillItem.count({ where: { testId: test.id } }),
    results: ownParamIds.length ? await Result.count({ where: { parameterId: ownParamIds } }) : 0,
    sharedTo,
    parameters: ownParamIds.length,
    clientPrices: await ClientTestPrice.count({ where: { testId: test.id } }),
    shortNames: await ClientTestShortName.count({ where: { testId: test.id } }),
    payorPrices: await PayorTestPrice.count({ where: { testId: test.id } }),
    packages,
  };
}

function deleteBlockReason(usage) {
  if (usage.bills > 0) return `This test is on ${usage.bills} patient bill(s), so it can't be deleted - mark it Inactive instead.`;
  if (usage.results > 0) return 'Results have been entered against this test\'s parameters, so it can\'t be deleted - mark it Inactive instead.';
  if (usage.sharedTo.length > 0) return `This test's parameters are also used by: ${usage.sharedTo.join(', ')}. Remove them from those tests first, or mark this test Inactive instead.`;
  return null;
}

// GET /api/admin/masters/tests/:id/usage  (Chief Admin only)
async function testUsage(req, res) {
  const test = await TestMaster.findByPk(req.params.id);
  if (!test) return res.status(404).json({ message: 'Test not found' });
  const { ownParamIds, ...usage } = await collectTestUsage(test);
  const blockedReason = deleteBlockReason(usage);
  return res.json({ ...usage, canDelete: !blockedReason, blockedReason });
}

// DELETE /api/admin/masters/tests/:id  (Chief Admin only)
// Permanently removes a test and all of its master data across every client:
// its parameters and their normal ranges, parameter links, every client's
// price and short name, payor prices and package memberships. Refused once
// the test has patient history (bills/results) - that must stay printable,
// so such a test is switched Inactive instead.
async function deleteTest(req, res) {
  const test = await TestMaster.findByPk(req.params.id);
  if (!test) return res.status(404).json({ message: 'Test not found' });
  const usage = await collectTestUsage(test);
  const blocked = deleteBlockReason(usage);
  if (blocked) return res.status(409).json({ message: blocked });

  await destroyTestWithMasterData(test, usage);
  return res.json({ message: `Test ${test.testCode} and its master data were deleted` });
}

// POST /api/admin/masters/tests/bulk  { action: 'activate' | 'deactivate' | 'delete', testIds: [...] }
// (Chief Admin only) - the multi-select / "select all" actions on the Test
// Removal screen. Each test is handled on its own: a test that can't be
// deleted is skipped with its reason instead of failing the whole batch.
async function bulkTestAction(req, res) {
  const { action } = req.body;
  const ids = Array.isArray(req.body.testIds) ? [...new Set(req.body.testIds.map(Number).filter(Boolean))] : [];
  if (!['activate', 'deactivate', 'delete'].includes(action)) return res.status(400).json({ message: 'action must be activate, deactivate or delete' });
  if (ids.length === 0) return res.status(400).json({ message: 'Select at least one test' });

  const tests = await TestMaster.findAll({ where: { id: ids } });
  if (action !== 'delete') {
    await TestMaster.update({ active: action === 'activate' }, { where: { id: tests.map((t) => t.id) } });
    return res.json({ done: tests.length, skipped: [] });
  }

  let done = 0;
  const skipped = [];
  for (const test of tests) {
    const usage = await collectTestUsage(test);
    const reason = deleteBlockReason(usage);
    if (reason) {
      skipped.push({ id: test.id, testCode: test.testCode, testName: test.testName, reason });
      continue;
    }
    await destroyTestWithMasterData(test, usage);
    done += 1;
  }
  return res.json({ done, skipped });
}

async function destroyTestWithMasterData(test, usage) {
  await sequelize.transaction(async (transaction) => {
    const { ownParamIds } = usage;
    if (ownParamIds.length) {
      await ParameterNormalRange.destroy({ where: { parameterId: ownParamIds }, transaction });
      await sequelize.query('DELETE FROM test_parameter_link WHERE "parameterId" IN (:ids)', { replacements: { ids: ownParamIds }, transaction });
    }
    await sequelize.query('DELETE FROM test_parameter_link WHERE "testId" = :testId', { replacements: { testId: test.id }, transaction });
    await sequelize.query('DELETE FROM package_test WHERE "testId" = :testId', { replacements: { testId: test.id }, transaction });
    await ParameterMaster.destroy({ where: { testId: test.id }, transaction });
    await ClientTestPrice.destroy({ where: { testId: test.id }, transaction });
    await ClientTestShortName.destroy({ where: { testId: test.id }, transaction });
    await PayorTestPrice.destroy({ where: { testId: test.id }, transaction });
    await test.destroy({ transaction });
  });
}

// POST /api/masters/tests/:testId/parameters
// Body: { parameterName, unit, method, normalRangeLow, normalRangeHigh,
//         normalRanges?: [{ gender, ageMin, ageMax, normalRangeLow, normalRangeHigh }] }
// parameterCode is always generated here, never accepted from the caller.
// normalRangeLow/High on the parameter itself are the default range, used
// whenever a result's patient doesn't match any age/gender-specific rule
// below. normalRanges is optional - a parameter can be created with just a
// default range and have age/gender rules added to it later.
async function addParameter(req, res) {
  const test = await TestMaster.findByPk(req.params.testId);
  if (!test) return res.status(404).json({ message: 'Test not found' });

  const { parameterName, unit, method, normalRangeLow, normalRangeHigh, description, isInterpretation, normalRanges } = req.body;
  const normalRangeText = req.body.normalRangeText?.toString().trim() || null;
  const normalRangeTextMale = req.body.normalRangeTextMale?.toString().trim() || null;
  const normalRangeTextFemale = req.body.normalRangeTextFemale?.toString().trim() || null;
  if (!parameterName) return res.status(400).json({ message: 'parameterName is required' });

  if (normalRanges !== undefined) {
    if (!Array.isArray(normalRanges)) return res.status(400).json({ message: 'normalRanges must be an array' });
    for (const r of normalRanges) {
      r.gender = rangeGender(r.gender);
      if (r.gender && !GENDER_OPTIONS.includes(r.gender)) {
        return res.status(400).json({ message: `Invalid gender "${r.gender}" - must be one of ${GENDER_OPTIONS.join(', ')}` });
      }
      if (r.ageUnit && !AGE_UNIT_OPTIONS.includes(r.ageUnit)) {
        return res.status(400).json({ message: `Invalid ageUnit "${r.ageUnit}" - must be one of ${AGE_UNIT_OPTIONS.join(', ')}` });
      }
      if (r.ageMaxUnit && !AGE_UNIT_OPTIONS.includes(r.ageMaxUnit)) {
        return res.status(400).json({ message: `Invalid Age To unit "${r.ageMaxUnit}" - must be one of ${AGE_UNIT_OPTIONS.join(', ')}` });
      }
    }
  }

  const clientId = requesterClientId(req);
  // A parameter name is meant to be unique per test (per client scope) - a rapid double-click/double-submit
  // of "Add Parameter" would otherwise create two identical rows. Return the existing one instead of erroring
  // so a resubmit is a harmless no-op rather than a duplicate or a scary failure.
  const existing = await ParameterMaster.findOne({
    where: { testId: test.id, clientId, parameterName: { [Op.iLike]: parameterName } },
    include: [ParameterNormalRange],
  });
  if (existing && existing.active === false) {
    // Re-adding a parameter that was removed earlier brings the same one back
    // (its history and ranges intact) instead of creating a duplicate.
    const seqGiven = req.body.sequence !== undefined && req.body.sequence !== '' && req.body.sequence !== null;
    const maxSeq = seqGiven ? null : await ParameterMaster.max('sequence', { where: { testId: test.id, active: true } });
    await existing.update({
      active: true, unit: unit ?? existing.unit, method: method ?? existing.method,
      normalRangeText: normalRangeText ?? existing.normalRangeText,
      normalRangeTextMale: normalRangeTextMale ?? existing.normalRangeTextMale,
      normalRangeTextFemale: normalRangeTextFemale ?? existing.normalRangeTextFemale,
      sequence: seqGiven ? Number(req.body.sequence) : (Number(maxSeq) || 0) + 1,
    });
    return res.status(200).json(existing);
  }
  if (existing) return res.status(200).json(existing);

  const parameterCode = await generateParameterCode();
  // A new parameter goes to the end of its test's order unless a sequence is given.
  const seqGiven = req.body.sequence !== undefined && req.body.sequence !== '' && req.body.sequence !== null;
  const maxSeq = seqGiven ? null : await ParameterMaster.max('sequence', { where: { testId: test.id } });
  const parameter = await ParameterMaster.create({
    testId: test.id, clientId, parameterCode, parameterName, unit, method, normalRangeLow, normalRangeHigh, normalRangeText, normalRangeTextMale, normalRangeTextFemale, description,
    isInterpretation: !!isInterpretation,
    sequence: seqGiven ? Number(req.body.sequence) : (Number(maxSeq) || 0) + 1,
  });

  for (const r of normalRanges || []) {
    await ParameterNormalRange.create({
      parameterId: parameter.id,
      gender: rangeGender(r.gender),
      ageMin: r.ageMin === '' || r.ageMin == null ? null : Number(r.ageMin),
      ageMax: r.ageMax === '' || r.ageMax == null ? null : Number(r.ageMax),
      ageUnit: r.ageUnit || 'Years',
      ageMaxUnit: r.ageMaxUnit || r.ageUnit || 'Years',
      normalRangeLow: r.normalRangeLow,
      normalRangeHigh: r.normalRangeHigh,
      rangeText: r.rangeText?.toString().trim() || null,
    });
  }

  const full = await ParameterMaster.findByPk(parameter.id, { include: [ParameterNormalRange] });
  return res.status(201).json(full);
}

// POST /api/masters/tests/:testId/parameters/:parameterId/assign
// Attaches an *existing* parameter to this test instead of creating a
// duplicate row - the same code, unit, method and normal ranges are shared,
// so editing them later (e.g. updating a range) updates every test that uses
// it. Idempotent: assigning the same parameter twice, or a parameter that's
// already this test's own, is a harmless no-op.
async function assignParameter(req, res) {
  const test = await TestMaster.findByPk(req.params.testId);
  if (!test) return res.status(404).json({ message: 'Test not found' });

  const parameter = await ParameterMaster.findByPk(req.params.parameterId, { include: [ParameterNormalRange] });
  if (!parameter) return res.status(404).json({ message: 'Parameter not found' });

  // A client may only assign a universal parameter or one of its own - never
  // another client's private parameter.
  const clientId = requesterClientId(req);
  if (clientId && parameter.clientId && parameter.clientId !== clientId) {
    return res.status(403).json({ message: 'You cannot assign another client\'s parameter' });
  }

  if (parameter.testId !== test.id) {
    // Checked explicitly (not just relying on the frontend's rapid-click
    // guard) so a double-click or retried request can't create a second
    // test_parameter_link row for the same pair - there's no unique
    // constraint on the auto-generated join table to catch that for us.
    const alreadyLinked = await test.hasAssignedParameter(parameter);
    if (!alreadyLinked) await test.addAssignedParameter(parameter);
  }
  return res.status(200).json(parameter);
}

// PUT /api/.../tests/:testId/parameter-order   Body: { parameterIds: [id, id, ...] }
// Saves the display order of a test's parameters (its own + assigned ones):
// the first id gets sequence 1, the next 2, and so on. Used for result entry
// and the printed report.
async function reorderParameters(req, res) {
  const test = await TestMaster.findByPk(req.params.testId);
  if (!test) return res.status(404).json({ message: 'Test not found' });
  const ids = Array.isArray(req.body.parameterIds) ? req.body.parameterIds.map(Number).filter(Boolean) : [];
  if (ids.length === 0) return res.status(400).json({ message: 'parameterIds is required' });

  // Only parameters that actually belong to (or are assigned to) this test.
  const owned = await ParameterMaster.findAll({ where: { id: ids, testId: test.id }, attributes: ['id'] });
  const assigned = await test.getAssignedParameters({ where: { id: ids }, attributes: ['id'], joinTableAttributes: [] });
  const allowed = new Set([...owned, ...assigned].map((p) => p.id));
  const clientId = requesterClientId(req);
  if (clientId) {
    // A client can't reorder another client's private parameters.
    const foreign = await ParameterMaster.count({ where: { id: [...allowed], clientId: { [Op.ne]: clientId } } });
    if (foreign > 0) return res.status(403).json({ message: 'You cannot reorder another client\'s parameters' });
  }

  let seq = 0;
  for (const id of ids) {
    if (!allowed.has(id)) continue;
    seq += 1;
    await ParameterMaster.update({ sequence: seq }, { where: { id } });
  }
  return res.json({ message: 'Parameter order saved', count: seq });
}

// Loads a parameter that belongs to (or is assigned to) a test, or explains why not.
async function findTestParameter(req) {
  const test = await TestMaster.findByPk(req.params.testId);
  if (!test) return { status: 404, message: 'Test not found' };
  const parameter = await ParameterMaster.findByPk(req.params.parameterId);
  if (!parameter) return { status: 404, message: 'Parameter not found' };
  const owned = parameter.testId === test.id;
  const linked = owned ? false : await test.hasAssignedParameter(parameter);
  if (!owned && !linked) return { status: 404, message: 'That parameter is not on this test' };
  return { test, parameter, owned };
}

// PUT /api/.../tests/:testId/parameters/:parameterId/sequence   Body: { sequence }
// Sets the parameter's display number (1, 2, 3 ...) used by result entry and
// the printed report. Blank clears it (the parameter then goes last).
async function setParameterSequence(req, res) {
  const found = await findTestParameter(req);
  if (found.status) return res.status(found.status).json({ message: found.message });
  const clientId = requesterClientId(req);
  if (clientId && found.parameter.clientId && found.parameter.clientId !== clientId) {
    return res.status(403).json({ message: 'You cannot change another client\'s parameter' });
  }
  const raw = req.body.sequence;
  const sequence = raw === '' || raw === null || raw === undefined ? null : Number(raw);
  if (sequence !== null && (!Number.isInteger(sequence) || sequence < 1 || sequence > 999)) {
    return res.status(400).json({ message: 'Sequence must be a whole number from 1 to 999' });
  }
  await found.parameter.update({ sequence });
  return res.json({ id: found.parameter.id, sequence });
}

// DELETE /api/.../tests/:testId/parameters/:parameterId
// Removes a parameter from this test. A parameter only *assigned* here (shared
// from another test) is simply unlinked. The test's own parameter is switched
// off (active = false) rather than deleted, so results already entered or
// released with it keep printing on old reports. A client can only remove its
// own parameters - the standard ones are shared with every client.
async function removeParameter(req, res) {
  const found = await findTestParameter(req);
  if (found.status) return res.status(found.status).json({ message: found.message });
  const { test, parameter, owned } = found;
  const clientId = requesterClientId(req);
  // A clinic removing a universal (Chief Admin) parameter hides it from this
  // test for itself only - the shared master and every other clinic keep it.
  if (clientId && parameter.clientId == null) {
    await ClientHiddenParameter.findOrCreate({
      where: { clientId, testId: test.id, parameterId: parameter.id },
      defaults: { createdBy: req.user?.username },
    });
    console.log(`Client ${clientId} hid universal parameter ${parameter.id} (${parameter.parameterName}) on test ${test.id} - ${req.user?.username || ''}`);
    return res.json({ message: 'Parameter removed from this test for your lab only' });
  }
  if (clientId && parameter.clientId !== clientId) {
    return res.status(403).json({ message: 'This parameter belongs to another client' });
  }
  if (owned) await parameter.update({ active: false });
  else await test.removeAssignedParameter(parameter);
  return res.json({ message: owned ? 'Parameter removed from the test' : 'Parameter unlinked from this test' });
}

// POST /api/test-config/tests/:testId/parameters/:parameterId/restore
// Brings back a universal parameter this clinic removed from a test for itself.
async function restoreHiddenParameter(req, res) {
  const clientId = requesterClientId(req);
  if (!clientId) return res.status(400).json({ message: 'Only a client can restore its own removed parameters' });
  const removed = await ClientHiddenParameter.destroy({
    where: { clientId, testId: req.params.testId, parameterId: req.params.parameterId },
  });
  if (!removed) return res.status(404).json({ message: 'That parameter is not removed for your lab' });
  return res.json({ message: 'Parameter restored to this test' });
}

// PUT /api/{admin/masters|masters|test-config}/parameters/:parameterId
// Body: { parameterName?, unit?, method?, description? }  (description: own/universal-by-Chief-Admin only)
// - Chief Admin: edits a universal parameter for everyone.
// - A clinic, its own parameter: edits it directly.
// - A clinic, a universal parameter: saves its own name/unit/method
//   (ClientParameterLabel) - only that clinic's screens and reports change.
//   A value equal to Chief Admin's (or blank) means "use Chief Admin's";
//   { reset: true } drops the clinic's version entirely.
async function updateParameterDetails(req, res) {
  const parameter = await ParameterMaster.findByPk(req.params.parameterId);
  if (!parameter) return res.status(404).json({ message: 'Parameter not found' });
  const clientId = requesterClientId(req);
  const by = req.user?.username || (clientId ? `client ${clientId}` : 'chief admin');
  const clean = (v) => (v === undefined ? undefined : (v === null ? '' : String(v).trim()));
  const name = clean(req.body.parameterName);
  const unit = clean(req.body.unit);
  const method = clean(req.body.method);
  const description = clean(req.body.description);

  // A clinic changing a universal parameter: its own version only.
  if (clientId && parameter.clientId == null) {
    const where = { clientId, parameterId: parameter.id };
    if (req.body.reset) {
      await ClientParameterLabel.destroy({ where });
      return res.json({ message: "Using Chief Admin's name, unit and method again", scope: 'client' });
    }
    // Blank or the same as Chief Admin's = follow Chief Admin's.
    const own = (v, master) => (v === undefined ? undefined : (v === '' || v === (master || '') ? null : v));
    const values = {
      parameterName: own(name, parameter.parameterName),
      unit: own(unit, parameter.unit),
      method: own(method, parameter.method),
    };
    const existing = await ClientParameterLabel.findOne({ where });
    const next = {
      parameterName: values.parameterName !== undefined ? values.parameterName : existing?.parameterName ?? null,
      unit: values.unit !== undefined ? values.unit : existing?.unit ?? null,
      method: values.method !== undefined ? values.method : existing?.method ?? null,
    };
    if (next.parameterName == null && next.unit == null && next.method == null) {
      if (existing) await existing.destroy();
    } else if (existing) {
      await existing.update({ ...next, updatedBy: by });
    } else {
      await ClientParameterLabel.create({ ...where, ...next, createdBy: by });
    }
    console.log(`Client ${clientId} set its own label for universal parameter ${parameter.id}: ${JSON.stringify(next)} - ${by}`);
    return res.json({ message: 'Saved for your lab only', scope: 'client', label: next });
  }

  if (clientId && parameter.clientId !== clientId) {
    return res.status(403).json({ message: 'This parameter belongs to another client' });
  }
  if (name !== undefined && !name) return res.status(400).json({ message: 'Parameter name is required' });

  const before = { parameterName: parameter.parameterName, unit: parameter.unit, method: parameter.method };
  await parameter.update({
    ...(name !== undefined && { parameterName: name }),
    ...(unit !== undefined && { unit: unit || null }),
    ...(method !== undefined && { method: method || null }),
    ...(description !== undefined && { description: description || null }),
    updatedBy: by,
  });
  console.log(`Parameter ${parameter.id} edited by ${by}: ${JSON.stringify(before)} -> ${JSON.stringify({ parameterName: parameter.parameterName, unit: parameter.unit, method: parameter.method })}`);
  return res.json({ message: clientId ? 'Parameter updated' : 'Parameter updated for all clients', scope: clientId ? 'own' : 'universal', parameter });
}

// POST /api/masters/parameters/:parameterId/ranges  - add one age/gender-specific
// normal range rule to an existing parameter.
async function addNormalRange(req, res) {
  const parameter = await ParameterMaster.findByPk(req.params.parameterId);
  if (!parameter) return res.status(404).json({ message: 'Parameter not found' });
  const clientId = requesterClientId(req);
  if (clientId && parameter.clientId != null && parameter.clientId !== clientId) {
    return res.status(403).json({ message: 'This parameter belongs to another client' });
  }
  // A clinic adding a range to a universal parameter adds it to its own copy
  // (made now if needed), never to the ranges other clinics share.
  const rowClientId = clientId && parameter.clientId == null ? clientId : null;
  if (rowClientId) await ensureClientOverride(rowClientId, parameter);

  const { ageMin, ageMax, ageUnit, ageMaxUnit, normalRangeLow, normalRangeHigh } = req.body;
  const gender = rangeGender(req.body.gender);
  const rangeText = req.body.rangeText?.toString().trim() || null;
  if (ageMaxUnit && !AGE_UNIT_OPTIONS.includes(ageMaxUnit)) {
    return res.status(400).json({ message: `Invalid Age To unit "${ageMaxUnit}" - must be one of ${AGE_UNIT_OPTIONS.join(', ')}` });
  }
  if (gender && !GENDER_OPTIONS.includes(gender)) {
    return res.status(400).json({ message: `Invalid gender "${gender}" - must be one of ${GENDER_OPTIONS.join(', ')}` });
  }
  if (ageUnit && !AGE_UNIT_OPTIONS.includes(ageUnit)) {
    return res.status(400).json({ message: `Invalid ageUnit "${ageUnit}" - must be one of ${AGE_UNIT_OPTIONS.join(', ')}` });
  }
  if (!normalRangeLow?.toString().trim() && !normalRangeHigh?.toString().trim() && !rangeText) {
    return res.status(400).json({ message: 'Enter a Range Low / High, or the text printed on the report' });
  }

  const normalizedAgeMin = ageMin === '' || ageMin == null ? null : Number(ageMin);
  const normalizedAgeMax = ageMax === '' || ageMax == null ? null : Number(ageMax);
  const normalizedAgeUnit = ageUnit || 'Years';
  const normalizedAgeMaxUnit = ageMaxUnit || normalizedAgeUnit;

  // Same defense-in-depth as addParameter above: a double-click/double-submit of "Add Range" would
  // otherwise create two identical rule rows, so an exact-match resubmit returns the existing one instead.
  const existing = await ParameterNormalRange.findOne({
    where: {
      parameterId: parameter.id,
      clientId: rowClientId,
      gender,
      ageMin: normalizedAgeMin,
      ageMax: normalizedAgeMax,
      ageUnit: normalizedAgeUnit,
      ageMaxUnit: normalizedAgeMaxUnit,
      normalRangeLow: normalRangeLow ?? null,
      normalRangeHigh: normalRangeHigh ?? null,
    },
  });
  if (existing) return res.status(200).json(existing);

  const range = await ParameterNormalRange.create({
    parameterId: parameter.id,
    clientId: rowClientId,
    gender,
    ageMin: normalizedAgeMin,
    ageMax: normalizedAgeMax,
    ageUnit: normalizedAgeUnit,
    ageMaxUnit: normalizedAgeMaxUnit,
    normalRangeLow, normalRangeHigh, rangeText,
  });
  return res.status(201).json(range);
}

// PUT /api/masters/parameters/:parameterId/ranges/:rangeId
//   Body: any of { gender, ageMin, ageMax, ageUnit, ageMaxUnit, normalRangeLow, normalRangeHigh, rangeText }
// (also PUT .../ranges/:rangeId/text with just { rangeText }). Edits one
// age/gender row - rangeText is what the report prints for patients it
// matches. A clinic editing a universal parameter's row edits its own copy
// only (made now if needed), like adding/removing a range.
async function updateNormalRange(req, res) {
  const parameter = await ParameterMaster.findByPk(req.params.parameterId);
  if (!parameter) return res.status(404).json({ message: 'Parameter not found' });
  let range = await ParameterNormalRange.findOne({ where: { id: req.params.rangeId, parameterId: parameter.id } });
  if (!range) return res.status(404).json({ message: 'Normal range rule not found' });
  const clientId = requesterClientId(req);

  const b = req.body;
  const changes = {};
  if (b.gender !== undefined) {
    b.gender = rangeGender(b.gender);
    if (!GENDER_OPTIONS.includes(b.gender)) return res.status(400).json({ message: `Invalid gender "${b.gender}" - must be one of ${GENDER_OPTIONS.join(', ')}` });
    changes.gender = b.gender;
  }
  if (b.ageUnit !== undefined) {
    if (!AGE_UNIT_OPTIONS.includes(b.ageUnit)) return res.status(400).json({ message: `Invalid ageUnit "${b.ageUnit}" - must be one of ${AGE_UNIT_OPTIONS.join(', ')}` });
    changes.ageUnit = b.ageUnit;
  }
  if (b.ageMaxUnit !== undefined) {
    if (!AGE_UNIT_OPTIONS.includes(b.ageMaxUnit)) return res.status(400).json({ message: `Invalid Age To unit "${b.ageMaxUnit}" - must be one of ${AGE_UNIT_OPTIONS.join(', ')}` });
    changes.ageMaxUnit = b.ageMaxUnit;
  }
  for (const k of ['ageMin', 'ageMax']) {
    if (b[k] === undefined) continue;
    if (b[k] === '' || b[k] === null) { changes[k] = null; continue; }
    if (!Number.isFinite(Number(b[k])) || Number(b[k]) < 0) return res.status(400).json({ message: 'Age From / Age To must be a number' });
    changes[k] = Number(b[k]);
  }
  for (const k of ['normalRangeLow', 'normalRangeHigh', 'rangeText']) {
    if (b[k] !== undefined) changes[k] = b[k]?.toString().trim() || null;
  }
  const after = { ...range.toJSON(), ...changes };
  if (!after.normalRangeLow && !after.normalRangeHigh && !after.rangeText) {
    return res.status(400).json({ message: 'Enter a Range Low / High, or the text printed on the report' });
  }

  if (clientId && parameter.clientId == null) {
    await sequelize.transaction(async (transaction) => {
      const { copyOf } = await ensureClientOverride(clientId, parameter, transaction);
      if (range.clientId == null) {
        const copyId = copyOf.get(range.id);
        if (!copyId) throw Object.assign(new Error('That range is not in your clinic\'s ranges any more - reload and try again'), { status: 404 });
        range = await ParameterNormalRange.findByPk(copyId, { transaction });
      } else if (range.clientId !== clientId) {
        throw Object.assign(new Error('Normal range rule not found'), { status: 404 });
      }
      await range.update(changes, { transaction });
    });
    return res.json(range);
  }
  if (clientId && parameter.clientId !== clientId) return res.status(403).json({ message: 'This parameter belongs to another client' });
  if (range.clientId != null) return res.status(404).json({ message: 'Normal range rule not found' });
  await range.update(changes);
  return res.json(range);
}

// DELETE /api/masters/parameters/:parameterId/ranges/:rangeId
async function deleteNormalRange(req, res) {
  const parameter = await ParameterMaster.findByPk(req.params.parameterId);
  if (!parameter) return res.status(404).json({ message: 'Parameter not found' });
  let range = await ParameterNormalRange.findOne({ where: { id: req.params.rangeId, parameterId: parameter.id } });
  if (!range) return res.status(404).json({ message: 'Normal range rule not found' });
  const clientId = requesterClientId(req);

  if (clientId && parameter.clientId == null) {
    // A clinic removing a range from a universal parameter removes it from its
    // own copy only: the first time, its copy is made from the shared rows and
    // the copy of this range is the one removed.
    await sequelize.transaction(async (transaction) => {
      const { copyOf } = await ensureClientOverride(clientId, parameter, transaction);
      if (range.clientId == null) {
        const copyId = copyOf.get(range.id);
        if (!copyId) throw Object.assign(new Error('That range is not in your clinic\'s ranges any more - reload and try again'), { status: 404 });
        range = await ParameterNormalRange.findByPk(copyId, { transaction });
      } else if (range.clientId !== clientId) {
        throw Object.assign(new Error('Normal range rule not found'), { status: 404 });
      }
      await range.destroy({ transaction });
    });
    return res.json({ message: 'Deleted' });
  }
  if (clientId && parameter.clientId !== clientId) return res.status(403).json({ message: 'This parameter belongs to another client' });
  // Chief Admin / a clinic's own parameter: only the parameter's own rows.
  if (range.clientId != null) return res.status(404).json({ message: 'Normal range rule not found' });
  await range.destroy();
  return res.json({ message: 'Deleted' });
}

// GET /api/admin/masters/tests/template  - a ready-to-fill Excel sheet covering
// every parameter field (code excluded - that's always generated): unit,
// method, default range, and one row per age/gender-specific range rule, so
// re-downloading it after edits doubles as an up-to-date export.
async function downloadTemplate(req, res) {
  // Chief-Admin-only endpoint - the export covers just the universal catalog,
  // never a client's own private parameters.
  const tests = await TestMaster.findAll({
    // Only the shared ranges - never a clinic's private copy.
    include: [{ model: ParameterMaster, where: { clientId: null, active: true }, required: false, include: [{ model: ParameterNormalRange, where: { clientId: null }, required: false }] }],
    order: [['testCode', 'ASC']],
  });

  const rows = [];
  for (const t of tests) {
    const params = t.ParameterMasters || [];
    if (params.length === 0) {
      rows.push({
        TEST_CODE: t.testCode, TEST_NAME: t.testName, TEST_CATEGORY: t.category || '', SAMPLE_TYPE: t.sampleType || '',
        PARAMETER_NAME: '', UNIT: '', METHOD: '', IS_INTERPRETATION: '',
        NORMAL_RANGE_LOW: '', NORMAL_RANGE_HIGH: '', GENDER: '', AGE_MIN: '', AGE_MAX: '', AGE_UNIT: '', AGE_TO_UNIT: '', RANGE_LOW: '', RANGE_HIGH: '',
      });
      continue;
    }
    for (const p of params) {
      const base = {
        TEST_CODE: t.testCode, TEST_NAME: t.testName, TEST_CATEGORY: t.category || '', SAMPLE_TYPE: t.sampleType || '',
        PARAMETER_NAME: p.parameterName,
        UNIT: p.unit || '', METHOD: p.method || '', IS_INTERPRETATION: p.isInterpretation ? 'Y' : '',
        NORMAL_RANGE_LOW: p.normalRangeLow || '', NORMAL_RANGE_HIGH: p.normalRangeHigh || '',
      };
      const ranges = p.ParameterNormalRanges || [];
      if (ranges.length === 0) {
        rows.push({ ...base, GENDER: '', AGE_MIN: '', AGE_MAX: '', AGE_UNIT: '', RANGE_LOW: '', RANGE_HIGH: '' });
      } else {
        for (const r of ranges) {
          rows.push({
            ...base, GENDER: r.gender, AGE_MIN: r.ageMin ?? '', AGE_MAX: r.ageMax ?? '', AGE_UNIT: r.ageUnit || 'Years', AGE_TO_UNIT: r.ageMaxUnit || r.ageUnit || 'Years',
            RANGE_LOW: r.normalRangeLow || '', RANGE_HIGH: r.normalRangeHigh || '',
          });
        }
      }
    }
  }
  if (rows.length === 0) {
    rows.push(
      {
        TEST_CODE: 'CBC001', TEST_NAME: 'Complete Blood Count', TEST_CATEGORY: 'Haematology', SAMPLE_TYPE: 'Blood',
        PARAMETER_NAME: 'Hemoglobin', UNIT: 'g/dL', METHOD: 'Photometry', IS_INTERPRETATION: '',
        NORMAL_RANGE_LOW: '13', NORMAL_RANGE_HIGH: '17', GENDER: '', AGE_MIN: '', AGE_MAX: '', AGE_UNIT: '', AGE_TO_UNIT: '', RANGE_LOW: '', RANGE_HIGH: '',
      },
      {
        TEST_CODE: 'CBC001', TEST_NAME: 'Complete Blood Count', TEST_CATEGORY: 'Haematology', SAMPLE_TYPE: 'Blood',
        PARAMETER_NAME: 'Hemoglobin', UNIT: 'g/dL', METHOD: 'Photometry', IS_INTERPRETATION: '',
        NORMAL_RANGE_LOW: '13', NORMAL_RANGE_HIGH: '17', GENDER: 'Male', AGE_MIN: '18', AGE_MAX: '60', AGE_UNIT: 'Years', AGE_TO_UNIT: 'Years', RANGE_LOW: '13', RANGE_HIGH: '17',
      },
      {
        TEST_CODE: 'CBC001', TEST_NAME: 'Complete Blood Count', TEST_CATEGORY: 'Haematology', SAMPLE_TYPE: 'Blood',
        PARAMETER_NAME: 'Hemoglobin', UNIT: 'g/dL', METHOD: 'Photometry', IS_INTERPRETATION: '',
        NORMAL_RANGE_LOW: '13', NORMAL_RANGE_HIGH: '17', GENDER: 'Female', AGE_MIN: '18', AGE_MAX: '60', AGE_UNIT: 'Years', AGE_TO_UNIT: 'Years', RANGE_LOW: '12', RANGE_HIGH: '15',
      },
      {
        TEST_CODE: 'WIDAL001', TEST_NAME: 'Widal Test', TEST_CATEGORY: 'Serology', SAMPLE_TYPE: 'Blood',
        PARAMETER_NAME: 'Interpretation', UNIT: '', METHOD: 'Slide Agglutination', IS_INTERPRETATION: 'Y',
        NORMAL_RANGE_LOW: '', NORMAL_RANGE_HIGH: '', GENDER: '', AGE_MIN: '', AGE_MAX: '', AGE_UNIT: '', AGE_TO_UNIT: '', RANGE_LOW: '', RANGE_HIGH: '',
      },
    );
  }

  const sheet = XLSX.utils.json_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, 'Tests & Parameters');
  const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename="test-parameter-template.xlsx"');
  return res.send(buffer);
}

// Preview only sends back this many rows for on-screen display (plus every
// invalid row, up to MAX_PREVIEW_ERRORS) - a 100k-row sheet would otherwise
// mean a huge response and a browser tab trying to draw 100k table rows.
const MAX_PREVIEW_ROWS = 300;
const MAX_PREVIEW_ERRORS = 500;
// Batch size for the IN (...) lookups and bulk inserts in commitUpload.
const DB_BATCH = 1000;

function chunk(list, size) {
  const out = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

// Spreadsheets spell these many ways - "ALL"/"Both" for everyone, "M"/"F",
// "yrs", any case. Map the common spellings to the stored values; anything
// unrecognised is returned as typed so the row check still flags it.
const GENDER_ALIASES = {
  any: 'All', all: 'All', both: 'All', a: 'All', everyone: 'All', common: 'All',
  male: 'Male', m: 'Male', female: 'Female', f: 'Female', other: 'Other', o: 'Other',
};
const AGE_UNIT_ALIASES = {
  years: 'Years', year: 'Years', yrs: 'Years', yr: 'Years', y: 'Years',
  months: 'Months', month: 'Months', mon: 'Months', mons: 'Months', mo: 'Months',
  days: 'Days', day: 'Days', d: 'Days',
};
function normalizeGender(value) {
  const v = String(value ?? '').trim();
  return GENDER_ALIASES[v.toLowerCase().replace(/\.$/, '')] || v;
}
function normalizeAgeUnit(value) {
  const v = String(value ?? '').trim();
  return AGE_UNIT_ALIASES[v.toLowerCase().replace(/\.$/, '')] || v;
}

// Reads the uploaded sheet into normalized rows and runs the per-row checks
// that don't need the database. Shared by previewUpload and commitUpload.
function parseUploadRows(buffer) {
  // Lean read options (no formatted-text/HTML/style copies of every cell)
  // keep a 100k-row sheet to roughly a third of the memory of a default read.
  const workbook = XLSX.read(buffer, {
    type: 'buffer', dense: true, cellText: false, cellHTML: false, cellFormula: false, cellStyles: false,
  });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });

  return rows.map((r, idx) => {
    const row = {
      row: idx + 2, // account for header row
      testCode: String(r.TEST_CODE || '').trim(),
      testName: String(r.TEST_NAME || '').trim(),
      testCategory: String(r.TEST_CATEGORY || '').trim(),
      sampleType: String(r.SAMPLE_TYPE || '').trim(),
      parameterName: String(r.PARAMETER_NAME || '').trim(),
      unit: String(r.UNIT || '').trim(),
      method: String(r.METHOD || '').trim(),
      isInterpretation: String(r.IS_INTERPRETATION || '').trim().toUpperCase() === 'Y',
      normalRangeLow: String(r.NORMAL_RANGE_LOW || '').trim(),
      normalRangeHigh: String(r.NORMAL_RANGE_HIGH || '').trim(),
      gender: normalizeGender(r.GENDER),
      ageMin: String(r.AGE_MIN ?? '').trim(),
      ageMax: String(r.AGE_MAX ?? '').trim(),
      ageUnit: normalizeAgeUnit(r.AGE_UNIT),
      ageMaxUnit: normalizeAgeUnit(r.AGE_TO_UNIT), // optional - blank = same as AGE_UNIT
      rangeLow: String(r.RANGE_LOW || '').trim(),
      rangeHigh: String(r.RANGE_HIGH || '').trim(),
    };
    const hasRangeRule = !!(row.rangeLow || row.rangeHigh);

    const errors = [];
    if (!row.testCode) errors.push('TEST_CODE is missing');
    if (!row.testName) errors.push('TEST_NAME is missing');
    if (hasRangeRule && !row.parameterName) errors.push('PARAMETER_NAME is required to add an age/gender range');
    if (row.gender && !GENDER_OPTIONS.includes(row.gender)) errors.push(`GENDER must be one of ${GENDER_OPTIONS.join(', ')}`);
    if (row.ageUnit && !AGE_UNIT_OPTIONS.includes(row.ageUnit)) errors.push(`AGE_UNIT must be one of ${AGE_UNIT_OPTIONS.join(', ')}`);
    if (row.ageMaxUnit && !AGE_UNIT_OPTIONS.includes(row.ageMaxUnit)) errors.push(`AGE_TO_UNIT must be one of ${AGE_UNIT_OPTIONS.join(', ')}`);
    if (row.ageMin && !/^\d+$/.test(row.ageMin)) errors.push('AGE_MIN must be a whole number');
    if (row.ageMax && !/^\d+$/.test(row.ageMax)) errors.push('AGE_MAX must be a whole number');

    return { ...row, hasRangeRule, valid: errors.length === 0, errors };
  });
}

// Loads the universal (clientId null) parameters of the given tests.
async function loadUniversalParams(testIds, attributes, transaction) {
  const params = [];
  for (const ids of chunk(testIds, DB_BATCH)) {
    params.push(...await ParameterMaster.findAll({ where: { testId: ids, clientId: null }, attributes, transaction }));
  }
  return params;
}

/**
 * Parses an uploaded Excel/CSV and validates each row, without writing
 * anything yet. Columns: TEST_CODE, TEST_NAME, TEST_CATEGORY, SAMPLE_TYPE,
 * PARAMETER_NAME, UNIT, METHOD, IS_INTERPRETATION, NORMAL_RANGE_LOW,
 * NORMAL_RANGE_HIGH, GENDER, AGE_MIN, AGE_MAX, AGE_UNIT, AGE_TO_UNIT, RANGE_LOW,
 * RANGE_HIGH. AGE_UNIT is AGE_MIN's unit; AGE_TO_UNIT (optional) is AGE_MAX's,
 * blank = same as AGE_UNIT. IS_INTERPRETATION ("Y" or blank) marks a qualitative
 * free-text parameter (e.g. a Widal conclusion) - its NORMAL_RANGE/RANGE_*
 * columns are ignored even if filled in. TEST_CATEGORY/SAMPLE_TYPE
 * only take effect the first time a TEST_CODE is created - they're test-level,
 * not per-row, so they're ignored on a row for a test that already exists.
 * A row with no PARAMETER_NAME just ensures the test
 * exists. A row whose RANGE_LOW/RANGE_HIGH are filled in adds an age/gender-
 * specific rule to that parameter (multiple rows can target the same
 * TEST_CODE+PARAMETER_NAME to add several rules). Step 1 of Preview ->
 * Validate -> Commit. Returns counts for the whole sheet but only a sample
 * of rows (see MAX_PREVIEW_ROWS) - the commit step re-reads the file itself.
 */
async function previewUpload(req, res) {
  if (!req.file) return res.status(400).json({ message: 'Excel/CSV file is required' });

  const rows = parseUploadRows(req.file.buffer);

  const codes = [...new Set(rows.map((r) => r.testCode).filter(Boolean))];
  const existingTests = [];
  for (const part of chunk(codes, DB_BATCH)) {
    existingTests.push(...await TestMaster.findAll({ where: { testCode: part }, attributes: ['id', 'testCode'] }));
  }
  const codeById = new Map(existingTests.map((t) => [t.id, t.testCode]));
  // Seeded from the database, then updated as rows are walked below - so a
  // brand-new test's first row (which introduces it) doesn't make every one
  // of its *other* rows in this same upload (its other parameters, or extra
  // age/gender range rows for the same parameter) look like they're each
  // creating ANOTHER new test/parameter too. Mirrors what commitUpload does
  // against the live database.
  const seenParamsByTestCode = new Map(existingTests.map((t) => [t.testCode, new Set()]));
  const params = await loadUniversalParams([...codeById.keys()], ['testId', 'parameterName', 'active']);
  for (const p of params) {
    if (p.active) seenParamsByTestCode.get(codeById.get(p.testId)).add(p.parameterName.toLowerCase());
  }

  let validRows = 0;
  const preview = [];
  let errorsShown = 0;
  for (const r of rows) {
    const { testCode, parameterName, hasRangeRule } = r;
    const isNewTest = !!testCode && !seenParamsByTestCode.has(testCode);
    const paramAlreadyExists = !isNewTest && !!parameterName
      && seenParamsByTestCode.get(testCode).has(parameterName.toLowerCase());

    let action;
    if (hasRangeRule) {
      action = `Add ${r.gender || 'All'} range rule${paramAlreadyExists ? '' : ' (+ new parameter)'}`;
    } else if (parameterName) {
      action = paramAlreadyExists ? 'Parameter already exists — skipped' : (isNewTest ? 'New test + parameter' : 'Add parameter');
    } else {
      action = isNewTest ? 'New test (no parameter)' : 'Test already exists';
    }

    // This row's test/parameter now "exist" for every later row in this same upload.
    if (testCode) {
      if (!seenParamsByTestCode.has(testCode)) seenParamsByTestCode.set(testCode, new Set());
      if (parameterName) seenParamsByTestCode.get(testCode).add(parameterName.toLowerCase());
    }

    if (r.valid) validRows += 1;
    const showRow = preview.length < MAX_PREVIEW_ROWS || (!r.valid && errorsShown < MAX_PREVIEW_ERRORS);
    if (showRow) {
      if (!r.valid) errorsShown += 1;
      const { hasRangeRule: _omit, ...shown } = r;
      preview.push({ ...shown, isNewTest, action });
    }
  }

  return res.json({
    totalRows: rows.length,
    validRows,
    invalidRows: rows.length - validRows,
    shownRows: preview.length,
    preview,
  });
}

// Writes the valid rows in bulk: one lookup + one insert per DB_BATCH of
// tests, parameters and range rules, instead of several queries per row -
// a 100k-row sheet finishes in seconds-to-minutes rather than hours.
async function commitRows(rows) {
  const results = { testsCreated: 0, parametersAdded: 0, rangesAdded: 0, skipped: 0, errors: [] };
  const usable = [];
  for (const row of rows) {
    if (!row.testCode || !row.testName) results.errors.push({ testCode: row.testCode, reason: 'Missing TEST_CODE or TEST_NAME' });
    else usable.push(row);
  }

  await sequelize.transaction(async (transaction) => {
    // 1. Tests - existing ones by code, the rest created from their first row.
    const testByCode = new Map();
    const codes = [...new Set(usable.map((r) => r.testCode))];
    for (const part of chunk(codes, DB_BATCH)) {
      for (const t of await TestMaster.findAll({ where: { testCode: part }, attributes: ['id', 'testCode'], transaction })) {
        testByCode.set(t.testCode, t);
      }
    }
    const newTests = new Map();
    for (const r of usable) {
      if (!testByCode.has(r.testCode) && !newTests.has(r.testCode)) {
        newTests.set(r.testCode, { testCode: r.testCode, testName: r.testName, category: r.testCategory || null, sampleType: r.sampleType || null });
      }
    }
    for (const part of chunk([...newTests.values()], DB_BATCH)) {
      for (const t of await TestMaster.bulkCreate(part, { transaction, returning: true })) testByCode.set(t.testCode, t);
    }
    results.testsCreated = newTests.size;

    // 2. Parameters - matched by exact name within the test, like before.
    const paramKey = (testId, name) => `${testId}\u0000${name}`;
    const paramByKey = new Map();
    const testIds = [...new Set(usable.map((r) => testByCode.get(r.testCode).id))];
    const existingParams = await loadUniversalParams(testIds, ['id', 'testId', 'parameterName', 'isInterpretation'], transaction);
    for (const p of existingParams) {
      const k = paramKey(p.testId, p.parameterName);
      if (!paramByKey.has(k)) paramByKey.set(k, p);
    }

    // Parameter codes continue from the highest PARM number in use - read once, not per row.
    const [[{ maxn }]] = await sequelize.query(
      `SELECT COALESCE(MAX(CAST(SUBSTRING("parameterCode" FROM '[0-9]+') AS BIGINT)), 0) AS maxn
         FROM parameter_master WHERE "parameterCode" ~ '[0-9]'`,
      { transaction },
    );
    let nextCode = Number(maxn) + 1;

    const newParams = new Map();
    const introducedBy = new Map(); // row object -> true if it created its parameter
    for (const r of usable) {
      if (!r.parameterName) continue;
      const k = paramKey(testByCode.get(r.testCode).id, r.parameterName);
      if (!paramByKey.has(k) && !newParams.has(k)) {
        newParams.set(k, {
          testId: testByCode.get(r.testCode).id, parameterName: r.parameterName, clientId: null,
          parameterCode: `PARM${String(nextCode++).padStart(3, '0')}`,
          unit: r.unit, method: r.method, isInterpretation: !!r.isInterpretation,
          normalRangeLow: r.normalRangeLow, normalRangeHigh: r.normalRangeHigh,
        });
        introducedBy.set(r, true);
      }
    }
    for (const part of chunk([...newParams.values()], DB_BATCH)) {
      const created = await ParameterMaster.bulkCreate(part, { transaction, returning: true });
      for (const p of created) paramByKey.set(paramKey(p.testId, p.parameterName), p);
    }

    // 3. Age/gender range rules - skipped when an identical rule already exists.
    const rangeKey = (parameterId, g, min, max, unit, low, high) => [parameterId, g, min ?? '', max ?? '', unit, low ?? '', high ?? ''].join('\u0000');
    const rangeRows = [];
    for (const r of usable) {
      if (!r.parameterName) continue;
      const parameter = paramByKey.get(paramKey(testByCode.get(r.testCode).id, r.parameterName));
      // Range rules don't apply to a qualitative/free-text interpretation parameter.
      const hasRangeRule = !parameter.isInterpretation && !!(String(r.rangeLow || '').trim() || String(r.rangeHigh || '').trim());
      if (introducedBy.get(r)) results.parametersAdded += 1;
      else if (!hasRangeRule) results.skipped += 1;
      if (hasRangeRule) rangeRows.push({ r, parameter });
    }

    const seenRanges = new Set();
    const rangeParamIds = [...new Set(rangeRows.map((x) => x.parameter.id))];
    for (const ids of chunk(rangeParamIds, DB_BATCH)) {
      const existing = await ParameterNormalRange.findAll({
        where: { parameterId: ids, clientId: null }, // shared rows only - not clinics' copies
        attributes: ['parameterId', 'gender', 'ageMin', 'ageMax', 'ageUnit', 'ageMaxUnit', 'normalRangeLow', 'normalRangeHigh'],
        transaction,
      });
      for (const e of existing) {
        seenRanges.add(rangeKey(e.parameterId, e.gender, e.ageMin, e.ageMax, `${e.ageUnit}/${e.ageMaxUnit || e.ageUnit}`, e.normalRangeLow, e.normalRangeHigh));
      }
    }
    const newRanges = [];
    for (const { r, parameter } of rangeRows) {
      const gender = normalizeGender(r.gender) || 'All';
      const ageUnit = normalizeAgeUnit(r.ageUnit) || 'Years';
      const ageMaxUnit = normalizeAgeUnit(r.ageMaxUnit) || ageUnit;
      const ageMin = r.ageMin === '' || r.ageMin == null ? null : Number(r.ageMin);
      const ageMax = r.ageMax === '' || r.ageMax == null ? null : Number(r.ageMax);
      const normalRangeLow = r.rangeLow || null;
      const normalRangeHigh = r.rangeHigh || null;
      const k = rangeKey(parameter.id, gender, ageMin, ageMax, `${ageUnit}/${ageMaxUnit}`, normalRangeLow, normalRangeHigh);
      if (seenRanges.has(k)) { results.skipped += 1; continue; }
      seenRanges.add(k);
      newRanges.push({ parameterId: parameter.id, gender, ageMin, ageMax, ageUnit, ageMaxUnit, normalRangeLow, normalRangeHigh });
    }
    for (const part of chunk(newRanges, DB_BATCH)) {
      await ParameterNormalRange.bulkCreate(part, { transaction });
    }
    results.rangesAdded = newRanges.length;
  });

  return results;
}

// POST /api/admin/masters/tests/upload/commit - either the same Excel/CSV file
// as the preview (multipart "file"; only its valid rows are written), or
// JSON { rows: [{ testCode, testName, parameterName, unit, method,
// normalRangeLow, normalRangeHigh, gender, ageMin, ageMax, ageUnit, ageMaxUnit, rangeLow, rangeHigh }] }
// (ageUnit = Age From's unit, ageMaxUnit = Age To's; blank = same as ageUnit).
async function commitUpload(req, res) {
  let rows;
  if (req.file) {
    rows = parseUploadRows(req.file.buffer).filter((r) => r.valid);
  } else {
    rows = (Array.isArray(req.body?.rows) ? req.body.rows : []).map((row) => ({
      ...row,
      testCode: String(row.testCode || '').trim(),
      testName: String(row.testName || '').trim(),
      parameterName: String(row.parameterName || '').trim(),
    }));
  }
  if (rows.length === 0) {
    return res.status(400).json({ message: req.file ? 'The file has no valid rows' : 'rows array is required' });
  }

  return res.json(await commitRows(rows));
}

module.exports = {
  createTest, listTests, updateTest, setClientSpecimen, testUsage, deleteTest, bulkTestAction, addParameter, assignParameter, addNormalRange, deleteNormalRange, updateNormalRange, reorderParameters, setParameterSequence, removeParameter, restoreHiddenParameter, updateParameterDetails,
  downloadTemplate, previewUpload, commitUpload, listTestGroups, createTestGroup, setParameterTrend, setNormalRangeText, resetParameterRanges,
};

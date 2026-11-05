const crypto = require('crypto');
const { Op } = require('sequelize');
const {
  sequelize, Sample, BillItem, TestMaster, ParameterMaster, Result, Report, Bill, Patient, Client,
  ReferralDoctor, Payor, ClientUser, ClientParameterTrend, ClientTestSpecimen,
} = require('../models');
const { locationWhere } = require('../utils/location');
const { buildParameterInsight } = require('../utils/trendInsights');
const { resolveNormalRange, printedRangeText } = require('../utils/normalRange');
const { sendEmail, sendWhatsApp } = require('../utils/notify');
const { sortParameters, sortResultsByParameter } = require('../utils/parameterOrder');
const { getCurrentActor } = require('../utils/auditContext');
const { fastingPostLunchConflict } = require('../utils/testType');
const { applyClientRanges } = require('../utils/clientRanges');

// A client doing result entry sees every universal parameter plus whatever
// parameters it added for itself for that test - never another client's own.
// Also includes parameters *assigned* to the test from elsewhere (see
// TestMaster.AssignedParameters in models/index.js) - merged into
// ParameterMasters by withResolvedRanges below, so result entry shows them
// exactly like the test's own parameters.
function buildSampleIncludes(clientId) {
  const paramWhere = { active: true, [Op.or]: [{ clientId: null }, { clientId }] };
  return [
    {
      model: BillItem,
      include: [
        {
          model: TestMaster,
          include: [
            { model: ParameterMaster, where: paramWhere, required: false },
            { model: ParameterMaster, as: 'AssignedParameters', where: paramWhere, required: false, through: { attributes: [] } },
          ],
        },
        { model: Bill, include: [Patient] },
      ],
    },
    Report,
    { model: Result, include: [ParameterMaster] },
  ];
}

// Deliberately NOT eager-loaded via a nested Sequelize `include` anywhere in
// this file - at 3+ levels of nesting (e.g. Sample->BillItem->TestMaster->
// ParameterMaster->ParameterNormalRange), Postgres's 63-byte identifier limit
// truncates the long generated join aliases, and Sequelize then maps the
// truncated columns back onto the wrong/colliding attribute names, silently
// corrupting the nested rows. Fetching ranges with their own flat query and
// attaching them in JS sidesteps that entirely.
// clientId: whose ranges - a clinic that customised a universal parameter
// gets its own copy (and printed text), otherwise the shared rows. See
// utils/clientRanges.js.
async function attachNormalRanges(parameterMasters, clientId) {
  await applyClientRanges(parameterMasters, clientId);
}

/**
 * Overrides every parameter's flat normalRangeLow/High in a sample's JSON
 * with the range resolved for this sample's own patient (age/gender), so
 * callers (result entry UI, isOutOfRange) never need their own age/gender
 * matching logic - they just read normalRangeLow/High as before.
 */
async function withResolvedRanges(sampleJson) {
  const patient = sampleJson.BillItem?.Bill?.Patient;
  const age = patient?.age;
  const gender = patient?.gender;
  const ageUnit = patient?.ageUnit;

  const testMaster = sampleJson.BillItem?.TestMaster;
  if (testMaster) {
    const owned = testMaster.ParameterMasters || [];
    const ownedIds = new Set(owned.map((p) => p.id));
    const assigned = (testMaster.AssignedParameters || []).filter((p) => !ownedIds.has(p.id));
    testMaster.ParameterMasters = sortParameters([...owned, ...assigned]);
    delete testMaster.AssignedParameters;
  }

  const params = sampleJson.BillItem?.TestMaster?.ParameterMasters;
  if (Array.isArray(params) && params.length > 0) {
    await attachNormalRanges(params, sampleJson.clientId);
    for (const p of params) {
      const resolved = resolveNormalRange(p, age, gender, ageUnit);
      p.normalRangeLow = resolved.normalRangeLow;
      p.normalRangeHigh = resolved.normalRangeHigh;
      // Result entry shows the same gender-wise Normal Range text the report prints.
      p.normalRangeText = printedRangeText(p, gender, resolved);
    }
  }
  return sampleJson;
}

// GET /api/lab/samples?status=PENDING_COLLECTION
async function listSamples(req, res) {
  const { clientId } = req.user;
  const { status } = req.query;
  const where = { clientId, ...locationWhere(req) };
  if (status) where.status = status;

  const samples = await Sample.findAll({ where, include: buildSampleIncludes(clientId), order: [['createdAt', 'DESC']] });
  const withRanges = await Promise.all(samples.map((s) => withResolvedRanges(s.toJSON())));
  // canRevoke: released and still inside the revoke window - the lab screen
  // offers Revoke only for these (the server re-checks on revoke anyway).
  for (const s of withRanges) s.canRevoke = !revokeBlockReason(s);
  return res.json(withRanges);
}

// GET /api/lab/samples/:id
async function getSample(req, res) {
  const { clientId } = req.user;
  const sample = await Sample.findOne({ where: { id: req.params.id, clientId }, include: buildSampleIncludes(clientId) });
  if (!sample) return res.status(404).json({ message: 'Sample not found' });
  return res.json(await withResolvedRanges(sample.toJSON()));
}

// POST /api/lab/samples/:id/collect
async function collectSample(req, res) {
  const { clientId } = req.user;
  const sample = await Sample.findOne({ where: { id: req.params.id, clientId } });
  if (!sample) return res.status(404).json({ message: 'Sample not found' });
  if (sample.status !== 'PENDING_COLLECTION') {
    return res.status(400).json({ message: `Sample already ${sample.status}` });
  }

  await sample.update({ status: 'COLLECTED', collectedAt: new Date(), collectedBy: getCurrentActor() });
  return res.json(sample);
}

// POST /api/lab/bills/:billId/collect  { sampleIds: [] }
// Collects the chosen tests of one order together. Fasting and Post Lunch
// samples are drawn at different times, so one call may include either
// (plus any Regular tests) but never both - the other is collected later.
async function collectSamples(req, res) {
  const { clientId } = req.user;
  const ids = [...new Set((req.body.sampleIds || []).map(Number).filter(Boolean))];
  if (ids.length === 0) return res.status(400).json({ message: 'Select at least one test to collect' });

  const samples = await Sample.findAll({
    where: { id: ids, clientId },
    include: [{ model: BillItem, where: { billId: req.params.billId }, include: [TestMaster] }],
  });
  if (samples.length !== ids.length) return res.status(404).json({ message: 'Some selected tests were not found on this order' });
  const notPending = samples.filter((s) => s.status !== 'PENDING_COLLECTION');
  if (notPending.length) {
    return res.status(400).json({ message: `Already ${notPending[0].status}: ${notPending.map((s) => s.BillItem.TestMaster?.testName).join(', ')}` });
  }
  const conflict = fastingPostLunchConflict(samples.map((s) => s.BillItem.TestMaster));
  if (conflict) return res.status(400).json({ message: conflict });

  await Sample.update(
    { status: 'COLLECTED', collectedAt: new Date(), collectedBy: getCurrentActor() },
    { where: { id: ids, clientId, status: 'PENDING_COLLECTION' } },
  );
  return res.json({ collected: ids.length });
}

// Parameters are optional at result entry - one left blank has no value to
// print, compare or share, so it is skipped everywhere a result is read back.
function hasValue(r) {
  return r.value != null && r.value.toString().trim() !== '';
}

function isOutOfRange(value, low, high) {
  const v = Number(value);
  if (Number.isNaN(v) || low == null || high == null) return false;
  const l = Number(low);
  const h = Number(high);
  if (Number.isNaN(l) || Number.isNaN(h)) return false;
  return v < l || v > h;
}

// POST /api/lab/samples/:id/results  { results: [{ parameterId, value }], remarks?, remarksBig? }
// Allowed up to and including VERIFIED - editing an already-verified result
// moves the sample back to RESULT_ENTERED, since a value change invalidates
// the earlier verification and it must be re-verified before release.
// remarks (optional free text, printed on the report under "Remarks") is saved
// alongside; omitting it leaves any existing remarks untouched.
async function enterResults(req, res) {
  const { clientId } = req.user;
  const { results = [], remarks, remarksBig } = req.body;
  if (!Array.isArray(results) || (results.length === 0 && remarks === undefined)) {
    return res.status(400).json({ message: 'results array is required' });
  }

  const sample = await Sample.findOne({
    where: { id: req.params.id, clientId },
    include: [Report, { model: BillItem, include: [{ model: Bill, include: [Patient] }] }],
  });
  if (!sample) return res.status(404).json({ message: 'Sample not found' });
  if (!['COLLECTED', 'RESULT_ENTERED', 'VERIFIED'].includes(sample.status)) {
    return res.status(400).json({ message: 'Sample must be collected before entering results' });
  }

  const patient = sample.BillItem?.Bill?.Patient;

  for (const r of results) {
    const parameter = await ParameterMaster.findByPk(r.parameterId);
    if (!parameter) continue;
    await attachNormalRanges([parameter], clientId); // this clinic's ranges decide the abnormal flag
    const range = resolveNormalRange(parameter, patient?.age, patient?.gender, patient?.ageUnit);
    const isAbnormal = isOutOfRange(r.value, range.normalRangeLow, range.normalRangeHigh);

    const [record] = await Result.findOrCreate({
      where: { sampleId: sample.id, parameterId: r.parameterId },
      defaults: { value: r.value, isAbnormal },
    });
    if (record.value !== r.value) await record.update({ value: r.value, isAbnormal });
  }

  const update = { status: 'RESULT_ENTERED', resultEnteredAt: new Date(), resultEnteredBy: getCurrentActor() };
  if (remarks !== undefined) {
    update.remarks = remarks?.toString().trim() || null;
    update.remarksBig = !!remarksBig;
  }
  await sample.update(update);
  if (sample.Report.status !== 'PENDING') {
    await sample.Report.update({ status: 'PENDING', verifiedAt: null });
  }
  return res.json({ message: 'Results saved' });
}

// POST /api/lab/samples/:id/verify
async function verifySample(req, res) {
  const { clientId } = req.user;
  const sample = await Sample.findOne({ where: { id: req.params.id, clientId }, include: [Report] });
  if (!sample) return res.status(404).json({ message: 'Sample not found' });
  if (sample.status !== 'RESULT_ENTERED') {
    return res.status(400).json({ message: 'Results must be entered before verification' });
  }

  await sample.update({ status: 'VERIFIED' });
  await sample.Report.update({ status: 'VERIFIED', verifiedAt: new Date(), verifiedBy: getCurrentActor() });
  return res.json({ message: 'Sample verified' });
}

// POST /api/lab/samples/:id/release
async function releaseSample(req, res) {
  const { clientId } = req.user;
  const sample = await Sample.findOne({
    where: { id: req.params.id, clientId },
    include: [Report, { model: BillItem, include: [Bill] }],
  });
  if (!sample) return res.status(404).json({ message: 'Sample not found' });
  if (sample.status !== 'VERIFIED') {
    return res.status(400).json({ message: 'Sample must be verified before release' });
  }
  const dueAmount = Number(sample.BillItem?.Bill?.dueAmount || 0);
  if (dueAmount > 0) {
    return res.status(400).json({
      message: `This bill has ₹${dueAmount.toFixed(2)} still due - collect it (Orders > Due Payment) before releasing the report.`,
    });
  }

  await sample.update({ status: 'RELEASED' });
  await sample.Report.update({ status: 'RELEASED', releasedAt: new Date(), releasedByUserId: req.user.id, releasedBy: getCurrentActor() });
  return res.json({ message: 'Report released' });
}

// PUT /api/lab/samples/:id/revoke  Body: { reason }
// Undoes a release (e.g. a mistake was found after the fact) - the report is
// never deleted, just stamped as revoked, and the sample rolls back to
// VERIFIED so results can be corrected and it can go through release again.
async function revokeReport(req, res) {
  const { clientId } = req.user;
  const { reason } = req.body;
  if (!reason?.trim()) return res.status(400).json({ message: 'A reason is required to revoke a released report' });

  const sample = await Sample.findOne({ where: { id: req.params.id, clientId }, include: [Report] });
  if (!sample) return res.status(404).json({ message: 'Sample not found' });
  const blocked = revokeBlockReason(sample);
  if (blocked) return res.status(400).json({ message: blocked });

  await sample.update({ status: 'VERIFIED' });
  await sample.Report.update({ status: 'REVOKED', revokedAt: new Date(), revokedReason: reason.trim(), revokedBy: getCurrentActor() });
  return res.json({ message: 'Report revoked' });
}

// A released report can be revoked for this many days after its release -
// after that the result is final and Revoke is no longer offered.
const REVOKE_WINDOW_DAYS = 5;

function revokeBlockReason(sample, testName = 'This test') {
  if (sample.status !== 'RELEASED') return `${testName}: only a released report can be revoked`;
  const releasedAt = sample.Report?.releasedAt;
  if (releasedAt && Date.now() - new Date(releasedAt).getTime() > REVOKE_WINDOW_DAYS * 24 * 60 * 60 * 1000) {
    return `${testName}: can only be revoked within ${REVOKE_WINDOW_DAYS} days of release`;
  }
  return null;
}

// PUT /api/lab/bills/:billId/revoke  { sampleIds: [], reason }
// Revokes the chosen released tests of one order together, with one reason.
// All-or-nothing: if any chosen test can't be revoked, none are.
async function revokeReports(req, res) {
  const { clientId } = req.user;
  const reason = req.body.reason?.trim();
  if (!reason) return res.status(400).json({ message: 'A reason is required to revoke a released report' });
  const ids = [...new Set((req.body.sampleIds || []).map(Number).filter(Boolean))];
  if (ids.length === 0) return res.status(400).json({ message: 'Select at least one test to revoke' });

  const samples = await Sample.findAll({
    where: { id: ids, clientId },
    include: [Report, { model: BillItem, where: { billId: req.params.billId }, include: [TestMaster] }],
  });
  if (samples.length !== ids.length) return res.status(404).json({ message: 'Some selected tests were not found on this order' });
  for (const s of samples) {
    const blocked = revokeBlockReason(s, s.BillItem.TestMaster?.testName);
    if (blocked) return res.status(400).json({ message: blocked });
  }

  const actor = getCurrentActor();
  await sequelize.transaction(async (transaction) => {
    for (const s of samples) {
      await s.update({ status: 'VERIFIED' }, { transaction });
      await s.Report.update({ status: 'REVOKED', revokedAt: new Date(), revokedReason: reason, revokedBy: actor }, { transaction });
    }
  });
  return res.json({ revoked: samples.length });
}

// GET /api/lab/bills/:billId/report
// A single consolidated report covering every RELEASED test on this bill -
// a patient with several tests on one visit gets one combined report, and
// tests not yet released simply aren't included until they are.
async function getBillReport(req, res) {
  const { clientId } = req.user;
  const bill = await Bill.findOne({ where: { id: req.params.billId, clientId }, include: [Patient, Client, ReferralDoctor, Payor] });
  if (!bill) return res.status(404).json({ message: 'Bill not found' });
  const report = await buildBillReport(bill);
  if (!report) return res.status(404).json({ message: 'No released reports for this bill yet' });
  // The QR code printed on the report links to /r/<reportToken>.
  if (!bill.reportToken) await bill.update({ reportToken: crypto.randomBytes(16).toString('hex') });
  return res.json({ ...report, reportToken: bill.reportToken });
}

// GET /api/public/reports/:token - no login: what the QR code on a printed
// report opens. Same released report as the lab sees (nothing unreleased or
// revoked); the token is 32 random hex characters, so it can't be guessed.
async function getPublicReport(req, res) {
  const token = String(req.params.token || '');
  if (!/^[a-f0-9]{32}$/.test(token)) return res.status(404).json({ message: 'Report not found' });
  const bill = await Bill.findOne({ where: { reportToken: token }, include: [Patient, Client, ReferralDoctor, Payor] });
  const report = bill && await buildBillReport(bill);
  if (!report) return res.status(404).json({ message: 'Report not found' });
  return res.json({ ...report, reportToken: token, isPublic: true });
}

/** The released report for one bill (null when nothing is released yet). */
async function buildBillReport(bill) {
  const { clientId } = bill;
  const samples = await Sample.findAll({
    where: { clientId },
    include: [
      { model: BillItem, where: { billId: bill.id }, include: [TestMaster] },
      { model: Report, include: [{ model: ClientUser, as: 'ReleasedByUser', attributes: ['name', 'username', 'designation', 'signaturePath', 'signatureName'] }] },
      { model: Result, include: [ParameterMaster] },
    ],
  });
  const releasedSamples = samples.filter((s) => s.status === 'RELEASED');
  if (releasedSamples.length === 0) return null;
  // This client's own specimen per test, where it set one (else Chief Admin's sample type).
  const specimenByTestId = new Map((await ClientTestSpecimen.findAll({
    where: { clientId: bill.clientId, testId: [...new Set(releasedSamples.map((s) => s.BillItem.TestMaster.id))] },
    attributes: ['testId', 'sampleType'],
  })).map((r) => [r.testId, r.sampleType]));

  const age = bill.Patient?.age;
  const gender = bill.Patient?.gender;
  const ageUnit = bill.Patient?.ageUnit;
  await attachNormalRanges(releasedSamples.flatMap((s) => s.Results.map((r) => r.ParameterMaster)), clientId);

  // A signature for a set of released tests: whoever released the most recent
  // of them represents it. Only a user who has actually set up a signature
  // (via Report Branding) shows one; otherwise none is printed.
  const signatureFor = (list) => {
    const latest = [...list].sort((a, b) => new Date(b.Report.releasedAt) - new Date(a.Report.releasedAt))[0];
    const user = latest?.Report?.ReleasedByUser;
    return user?.signaturePath
      ? { name: user.signatureName || user.name || user.username, designation: user.designation, signatureUrl: user.signaturePath }
      : null;
  };
  const doctor = signatureFor(releasedSamples);

  const testJson = (s) => ({
    testName: s.BillItem.TestMaster.testName,
    testCode: s.BillItem.TestMaster.testCode,
    // This client's own specimen if it set one, else Chief Admin's - printed in bold under the test's results.
    sampleType: specimenByTestId.get(s.BillItem.TestMaster.id) || s.BillItem.TestMaster.sampleType || null,
    interpretation: s.BillItem.TestMaster.interpretation,
    barcode: s.barcode,
    collectedAt: s.collectedAt,
    releasedAt: s.Report.releasedAt,
    remarks: s.remarks || null,
    remarksBig: s.remarksBig,
    parameters: sortResultsByParameter(s.Results.filter(hasValue)).map((r) => {
      const range = resolveNormalRange(r.ParameterMaster, age, gender, ageUnit);
      return {
        parameterCode: r.ParameterMaster.parameterCode,
        parameterName: r.ParameterMaster.parameterName,
        value: r.value,
        unit: r.ParameterMaster.unit,
        normalRangeLow: range.normalRangeLow,
        normalRangeHigh: range.normalRangeHigh,
        normalRangeText: printedRangeText(r.ParameterMaster, gender, range), // the matching age/gender row's text (or the parameter's), printed instead of low - high when set
        isAbnormal: r.isAbnormal,
        isInterpretation: r.ParameterMaster.isInterpretation,
      };
    }),
  });

  // The report is printed group by group (each group on its own page(s), its
  // name above its tests, its own signature after them) - see
  // groupReportSamples for the order.
  const groups = groupReportSamples(releasedSamples).map((g) => ({
    name: g.name,
    tests: g.samples.map(testJson),
    doctor: signatureFor(g.samples),
  }));

  return {
    groups,
    doctor,
    bill: {
      id: bill.id, billNo: bill.billNo, createdAt: bill.createdAt, walkInDate: bill.walkInDate,
      referredDoctor: bill.ReferralDoctor?.name || null,
      payor: bill.Payor?.name || null,
    },
    patient: bill.Patient,
    // Branding details (set from Report Branding) shown on the report -
    // separate from clientName/address/mobile/email Chief Admin set at
    // client creation, falling back to those until this client sets its own.
    client: {
      clientName: bill.Client.brandingName || bill.Client.clientName,
      address: bill.Client.brandingAddress || bill.Client.address,
      mobile: bill.Client.brandingMobile || bill.Client.mobile,
      email: bill.Client.brandingEmail || bill.Client.email,
      logoUrl: bill.Client.reportLogoPath,
      letterheadUrl: bill.Client.reportLetterheadPath,
      letterheadTopMm: bill.Client.reportTopMarginMm,
      letterheadBottomMm: bill.Client.reportBottomMarginMm,
    },
    // Same tests, flat in group order - kept for anything reading the old shape.
    tests: groups.flatMap((g) => g.tests),
  };
}

// Report group order: Haematology first, Biochemistry next, then any other
// service group alphabetically, and tests with no group last. Group names are
// free-ish text (e.g. "Hae", "Hematology", "BIO", "Clinical Biochemistry"),
// so the first two are recognised by spelling rather than exact name.
function groupRank(name) {
  if (!name) return 3;
  // "bio" first: "Biochemistry" itself contains "hem".
  if (/bio/i.test(name)) return 1;
  if (/haem|hemat|^hae|^hem/i.test(name)) return 0;
  return 2;
}

// Groups samples by their test's service group (case-insensitive), in report order.
function groupReportSamples(samples) {
  const byKey = new Map();
  for (const s of samples) {
    const name = s.BillItem.TestMaster.category?.trim() || '';
    const key = name.toLowerCase();
    if (!byKey.has(key)) byKey.set(key, { name: name || 'Other Tests', rank: groupRank(name), samples: [] });
    byKey.get(key).samples.push(s);
  }
  return [...byKey.values()].sort((a, b) => a.rank - b.rank || a.name.localeCompare(b.name));
}

// POST /api/report-view/bills/:billId/report/share  Body: { channel: 'whatsapp' | 'email', to? }
// `to` defaults to the patient's own mobile/email on file. Sends a text/HTML
// summary of released results, not a copy of the printed report - sendWhatsApp/
// sendEmail don't support attachments today (see utils/notify.js).
async function shareReport(req, res) {
  const { clientId } = req.user;
  const { channel, to } = req.body;
  if (channel !== 'whatsapp' && channel !== 'email') {
    return res.status(400).json({ message: 'channel must be "whatsapp" or "email"' });
  }

  const bill = await Bill.findOne({ where: { id: req.params.billId, clientId }, include: [Patient, Client] });
  if (!bill) return res.status(404).json({ message: 'Bill not found' });

  const samples = await Sample.findAll({
    where: { clientId, status: 'RELEASED' },
    include: [
      { model: BillItem, where: { billId: bill.id }, include: [TestMaster] },
      Report,
      { model: Result, include: [ParameterMaster] },
    ],
  });
  if (samples.length === 0) return res.status(404).json({ message: 'No released reports for this bill yet' });

  const age = bill.Patient?.age;
  const gender = bill.Patient?.gender;
  const ageUnit = bill.Patient?.ageUnit;
  await attachNormalRanges(samples.flatMap((s) => s.Results.map((r) => r.ParameterMaster)), clientId);

  const lines = samples.map((s) => {
    const testLine = `${s.BillItem.TestMaster.testName}:`;
    const paramLines = sortResultsByParameter(s.Results.filter(hasValue)).map((r) => {
      if (r.ParameterMaster.isInterpretation) {
        return `  ${r.ParameterMaster.parameterName}: ${r.value}`;
      }
      const range = resolveNormalRange(r.ParameterMaster, age, gender, ageUnit);
      const flag = r.isAbnormal ? ' (abnormal)' : '';
      return `  ${r.ParameterMaster.parameterName}: ${r.value} ${r.ParameterMaster.unit || ''} (Normal: ${printedRangeText(r.ParameterMaster, bill.Patient?.gender, range) || `${range.normalRangeLow}-${range.normalRangeHigh}`})${flag}`;
    }).join('\n');
    const remarksLine = s.remarks ? `\n  Remarks: ${s.remarks.replace(/\t/g, ' | ')}` : '';
    return `${testLine}\n${paramLines}${remarksLine}`;
  }).join('\n\n');

  if (channel === 'whatsapp') {
    const mobile = to || bill.Patient?.mobile;
    if (!mobile) return res.status(400).json({ message: "No mobile number on file for this patient - provide 'to'" });
    const result = await sendWhatsApp({
      to: mobile,
      message: `Hi ${bill.Patient?.name || ''}, here is your lab report from ${bill.Client.clientName}.\n\n${lines}\n\nThank you!`,
    });
    return res.json(result);
  }

  const email = to || bill.Patient?.email;
  if (!email) return res.status(400).json({ message: "No email on file for this patient - provide 'to'" });
  const result = await sendEmail({
    to: email,
    subject: `Your lab report from ${bill.Client.clientName} - Bill ${bill.billNo}`,
    html: `<p>Hi ${bill.Patient?.name || ''},</p><p>Here is your lab report from ${bill.Client.clientName}.</p><pre>${lines}</pre><p>Thank you!</p>`,
  });
  return res.json(result);
}

/** Every past RELEASED value this patient has for one parameter, oldest first. */
// The same test parameter often exists as several ParameterMaster rows over
// time (e.g. "Hemoglobin" re-created, or an old row switched off and a new one
// made) - a patient's earlier values sit under whichever row was live then.
// For each given parameter, returns every row this client can see with the
// same name and unit (inactive ones too), so history spans all of them.
// Units only have to match when both rows have one.
async function equivalentParameterIds(clientId, params) {
  const nameKey = (p) => p.parameterName.trim().toLowerCase();
  const unitKey = (p) => (p.unit || '').replace(/\s+/g, '').toLowerCase();
  const names = [...new Set(params.map(nameKey))];
  if (names.length === 0) return new Map();
  const candidates = await ParameterMaster.findAll({
    where: {
      [Op.and]: [
        sequelize.where(sequelize.fn('lower', sequelize.fn('trim', sequelize.col('parameterName'))), { [Op.in]: names }),
        { [Op.or]: [{ clientId: null }, { clientId }] },
      ],
    },
    attributes: ['id', 'parameterName', 'unit', 'isInterpretation'],
  });
  return new Map(params.map((p) => [p.id, [...new Set([p.id, ...candidates
    .filter((c) => nameKey(c) === nameKey(p) && !!c.isInterpretation === !!p.isInterpretation
      && (!unitKey(c) || !unitKey(p) || unitKey(c) === unitKey(p)))
    .map((c) => c.id)])]]));
}

// parameterIds: the parameter plus its equivalents (equivalentParameterIds).
// Only orders made up to `asOf` (the bill being viewed), so an older report never shows values from later visits.
async function getPatientParameterHistory(clientId, patientId, parameterIds, asOf) {
  const results = await Result.findAll({
    where: { parameterId: parameterIds },
    include: [
      {
        model: Sample,
        required: true,
        where: { clientId, status: 'RELEASED' },
        include: [
          { model: BillItem, required: true, include: [{ model: Bill, required: true, where: { patientId, createdAt: { [Op.lte]: asOf } } }] },
          { model: Report, required: true },
        ],
      },
    ],
  });

  return onePerVisit(results.filter(hasValue).filter((r) => r.Sample.Report.releasedAt));
}

// How many visits the report's AI Trend section shows per parameter.
const TREND_VISITS = 3;

// One point per visit (order): the same parameter can hold a value under two
// equivalent rows on one order (e.g. an old and a new "Hemoglobin" both on
// that day's CBC) - counting both would double that visit in the trend.
// Ordered by visit (the order's date), not release time - an older order
// released or re-released later must still sit at its own place.
// Where one visit has two, the newest parameter row's value is used.
function onePerVisit(results) {
  const byBill = new Map();
  for (const r of [...results].sort((a, b) => b.parameterId - a.parameterId)) {
    const bill = r.Sample.BillItem.Bill;
    if (!byBill.has(bill.id)) {
      byBill.set(bill.id, {
        date: r.Sample.Report.releasedAt, visitedAt: bill.createdAt, value: r.value, isAbnormal: r.isAbnormal, billNo: bill.billNo,
      });
    }
  }
  return [...byBill.values()].sort((a, b) => new Date(a.visitedAt) - new Date(b.visitedAt));
}

const PENDING_STATUS_LABEL = {
  PENDING_COLLECTION: 'Pending collection',
  COLLECTED: 'Collected',
  RESULT_ENTERED: 'Result entered',
  VERIFIED: 'Verified',
};

// GET /api/report-view/pending-tests?from=YYYY-MM-DD&to=YYYY-MM-DD[&format=xlsx]
// Every test still in progress - from registration (billing) up to, but not
// including, report release - for the client's pending worklist. Filtered by
// the bill's walk-in date; cancelled tests are left out. format=xlsx returns
// the same rows as an Excel download instead of JSON.
async function getPendingTests(req, res) {
  const { clientId } = req.user;
  const { from, to, format, status, q } = req.query;
  const billWhere = {};
  if (from || to) {
    billWhere.walkInDate = {};
    if (from) billWhere.walkInDate[Op.gte] = from;
    if (to) billWhere.walkInDate[Op.lte] = to;
  }

  const samples = await Sample.findAll({
    where: {
      clientId,
      ...locationWhere(req),
      status: { [Op.in]: PENDING_STATUS_LABEL[status] ? [status] : Object.keys(PENDING_STATUS_LABEL) },
    },
    include: [{
      model: BillItem,
      required: true,
      where: { status: 'ACTIVE' },
      include: [
        TestMaster,
        { model: Bill, required: true, where: billWhere, include: [Patient] },
      ],
    }],
    order: [['id', 'DESC']],
  });

  // Optional free-text search (same fields the screen searches), so an export
  // contains exactly the rows on screen.
  const needle = (q || '').toString().trim().toLowerCase();
  const rows = samples.map((s) => {
    const bill = s.BillItem.Bill;
    return {
      sampleId: s.id,
      patientName: bill.Patient?.name || '',
      age: bill.Patient?.age ?? null,
      ageUnit: bill.Patient?.ageUnit || 'Years',
      gender: bill.Patient?.gender || '',
      mobile: bill.Patient?.mobile || '',
      barcode: s.barcode,
      billNo: bill.billNo,
      umr: bill.Patient?.umr || '',
      testName: s.BillItem.TestMaster?.testName || '',
      status: s.status,
      statusLabel: PENDING_STATUS_LABEL[s.status],
      priority: bill.priority || 'ROUTINE',
      walkInDate: bill.walkInDate,
      registeredAt: bill.createdAt,
      updatedAt: s.updatedAt,
    };
  }).filter((r) => !needle || [r.patientName, r.barcode, r.billNo, r.umr, r.testName, r.mobile]
    .some((f) => (f || '').toString().toLowerCase().includes(needle)));

  if (format === 'xlsx') {
    const XLSX = require('xlsx');
    const sheet = XLSX.utils.json_to_sheet(rows.map((r) => ({
      'Patient Name': r.patientName,
      Barcode: r.barcode,
      'Bill No': r.billNo,
      'UMR No': r.umr,
      'Test Name': r.testName,
      'Test Status': r.statusLabel,
      'Walk-in Date': r.walkInDate,
      Priority: r.priority,
      Mobile: r.mobile,
    })));
    sheet['!cols'] = [{ wch: 24 }, { wch: 20 }, { wch: 20 }, { wch: 12 }, { wch: 28 }, { wch: 18 }, { wch: 12 }, { wch: 10 }, { wch: 13 }];
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, sheet, 'Pending Tests');
    const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="pending-tests_${from || 'all'}_to_${to || 'all'}.xlsx"`);
    return res.send(buffer);
  }
  return res.json(rows);
}

// GET /api/lab/bills/:billId/previous-results
// For delta checks during result entry: this patient's most recent RELEASED
// value of each parameter on this bill, taken from any *earlier* bill (never
// this one). Shape: { [parameterId]: { value, date, isAbnormal, billNo } }.
async function getPreviousResults(req, res) {
  const { clientId } = req.user;
  const bill = await Bill.findOne({ where: { id: req.params.billId, clientId } });
  if (!bill) return res.status(404).json({ message: 'Bill not found' });

  // The bill's parameters: each test's own plus those *assigned* to it from
  // another test (e.g. a shared Hemoglobin) - same set result entry shows.
  const items = await BillItem.findAll({
    where: { billId: bill.id },
    include: [{
      model: TestMaster,
      include: [
        { model: ParameterMaster, required: false },
        { model: ParameterMaster, as: 'AssignedParameters', required: false, through: { attributes: [] } },
      ],
    }],
  });
  const params = new Map();
  for (const p of items.flatMap((i) => [...(i.TestMaster?.ParameterMasters || []), ...(i.TestMaster?.AssignedParameters || [])])) {
    if (p.active !== false && !p.isInterpretation) params.set(p.id, p);
  }
  if (params.size === 0) return res.json({});

  // A previous value may sit under an older row of the same parameter -
  // map each such row back to the bill's own parameter id(s).
  const equivalents = await equivalentParameterIds(clientId, [...params.values()]);
  const targetsById = new Map();
  for (const [paramId, ids] of equivalents) {
    for (const id of ids) targetsById.set(id, [...(targetsById.get(id) || []), paramId]);
  }

  const results = await Result.findAll({
    where: { parameterId: [...targetsById.keys()] },
    include: [{
      model: Sample,
      required: true,
      where: { clientId, status: 'RELEASED' },
      include: [
        { model: BillItem, required: true, include: [{ model: Bill, required: true, where: { patientId: bill.patientId, id: { [Op.ne]: bill.id }, createdAt: { [Op.lt]: bill.createdAt } } }] },
        { model: Report, required: true },
      ],
    }],
  });

  // Every earlier visit per parameter, oldest first - shown at result entry
  // for all parameters (the report's Trend tick box doesn't apply here).
  const resultsById = {};
  for (const r of results) {
    if (!r.Sample.Report.releasedAt || !hasValue(r)) continue;
    for (const paramId of targetsById.get(r.parameterId) || []) (resultsById[paramId] ||= []).push(r);
  }

  // Latest *visit* wins, not latest release - see onePerVisit.
  const latest = {};
  for (const [paramId, paramResults] of Object.entries(resultsById)) {
    const history = onePerVisit(paramResults);
    latest[paramId] = { ...history[history.length - 1], history };
  }
  return res.json(latest);
}

// GET /api/lab/bills/:billId/trend  ("AI Report" - each parameter on this bill
// compared against this same patient's own history of that same parameter,
// with a short rule-based interpretation of the trend).
async function getBillTrendReport(req, res) {
  const { clientId } = req.user;
  const bill = await Bill.findOne({ where: { id: req.params.billId, clientId }, include: [Patient] });
  if (!bill) return res.status(404).json({ message: 'Bill not found' });

  const samples = await Sample.findAll({
    where: { clientId, status: 'RELEASED' },
    include: [
      { model: BillItem, where: { billId: bill.id }, include: [TestMaster] },
      Report,
      { model: Result, include: [ParameterMaster] },
    ],
  });
  if (samples.length === 0) {
    return res.status(404).json({ message: 'No released reports for this bill yet' });
  }
  await attachNormalRanges(samples.flatMap((s) => s.Results.map((r) => r.ParameterMaster)), clientId);

  // Only parameters this client ticked "Trend" for (Test Parameters screen) -
  // set per parameter, so it applies on every test the parameter is mapped to.
  const trended = new Set((await ClientParameterTrend.findAll({ where: { clientId }, attributes: ['parameterId'] }))
    .map((r) => r.parameterId));
  // A tick follows the parameter, not one exact row: an older order may hold
  // its value under an earlier row of the same parameter (same name + unit),
  // so a parameter counts as ticked when any of its equivalent rows is.
  const equivalents = await equivalentParameterIds(clientId, samples
    .flatMap((s) => s.Results.map((r) => r.ParameterMaster))
    .filter((p) => !p.isInterpretation));
  const isTrended = (paramId) => (equivalents.get(paramId) || [paramId]).some((id) => trended.has(id));

  const parameters = [];
  const trendedKeys = new Set(); // one row per parameter, even if this order holds it under two equivalent rows
  for (const sample of samples) {
    for (const result of sortResultsByParameter([...sample.Results])) {
      const param = result.ParameterMaster;
      if (!isTrended(param.id)) continue;
      if (param.isInterpretation) continue; // a trend/sparkline over free text is meaningless
      if (!hasValue(result)) continue; // left blank at entry - nothing to trend
      const key = `${sample.BillItem.testId}:${Math.min(...(equivalents.get(param.id) || [param.id]))}`;
      if (trendedKeys.has(key)) continue;
      trendedKeys.add(key);
      const fullHistory = await getPatientParameterHistory(clientId, bill.patientId, equivalents.get(param.id) || [param.id], bill.createdAt);
      // This visit's point is the value printed on this report (another
      // equivalent row on the same order may hold a different one).
      const current = fullHistory.find((h) => h.billNo === bill.billNo);
      if (current) Object.assign(current, { value: result.value, isAbnormal: result.isAbnormal });
      // The report shows the last TREND_VISITS visits, this one included.
      const history = fullHistory.slice(-TREND_VISITS);
      const range = resolveNormalRange(param, bill.Patient?.age, bill.Patient?.gender, bill.Patient?.ageUnit);
      parameters.push({
        barcode: sample.barcode, // ties the row to its test on the report (printed right under that test)
        testName: sample.BillItem.TestMaster.testName,
        parameterCode: param.parameterCode,
        parameterName: param.parameterName,
        unit: param.unit,
        normalRangeLow: range.normalRangeLow,
        normalRangeHigh: range.normalRangeHigh,
        history,
        insight: buildParameterInsight(history),
      });
    }
  }

  return res.json({
    patient: { name: bill.Patient.name, umr: bill.Patient.umr },
    parameters,
  });
}

module.exports = {
  listSamples, getSample, collectSample, collectSamples, enterResults, verifySample, releaseSample, revokeReport, revokeReports, getBillReport, getPublicReport, getBillTrendReport, shareReport,
  getPreviousResults, getPendingTests,
};

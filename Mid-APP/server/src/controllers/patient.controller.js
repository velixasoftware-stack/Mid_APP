const { Op } = require('sequelize');
const { Patient } = require('../models');

/**
 * Generates the next UMR for a client - e.g. UMR000123. Reused for every future visit of that patient.
 * Based on the highest existing number, not the patient count: once any patient has been deleted,
 * count + 1 lands on a UMR that's already taken and the insert fails the (clientId, umr) unique index.
 */
async function generateUmr(clientId) {
  const umrs = await Patient.findAll({ where: { clientId }, attributes: ['umr'], raw: true });
  const highest = umrs.reduce((max, { umr }) => {
    const n = parseInt(String(umr).replace(/^UMR/i, ''), 10);
    return Number.isNaN(n) ? max : Math.max(max, n);
  }, 0);
  return `UMR${String(highest + 1).padStart(6, '0')}`;
}

/**
 * Finds an existing patient by UMR or mobile number for this client, or
 * registers a new one (with a freshly generated UMR) if none matches.
 * Shared by the standalone patient-registration endpoint and by billing,
 * so a patient is only ever registered once no matter which screen is used.
 */
async function findOrCreatePatient(clientId, { umr, title, name, age, ageUnit, gender, mobile, email, address }) {
  if (mobile && mobile.length > 10) {
    throw new Error('Mobile number cannot be more than 10 digits');
  }
  if (umr) {
    const byUmr = await Patient.findOne({ where: { clientId, umr } });
    if (byUmr) return byUmr;
  }
  if (mobile) {
    const byMobile = await Patient.findOne({ where: { clientId, mobile } });
    if (byMobile) return byMobile;
  }
  if (!name) throw new Error('Patient name is required to register a new patient');
  if (age === undefined || age === null || age === '' || Number.isNaN(Number(age)) || Number(age) < 0) {
    throw new Error('Patient age is required to register a new patient');
  }

  // Two new patients registered at the same moment for one client can both
  // compute the same next UMR - the (clientId, umr) unique index rejects the
  // second, so just recompute and try again rather than failing the bill.
  for (let attempt = 1; ; attempt += 1) {
    const newUmr = await generateUmr(clientId);
    try {
      return await Patient.create({ clientId, umr: newUmr, title: title || null, name, age, ageUnit: ageUnit || 'Years', gender, mobile, email, address });
    } catch (err) {
      if (err?.name !== 'SequelizeUniqueConstraintError' || attempt >= 5) throw err;
    }
  }
}

// POST /api/patients
async function createPatient(req, res) {
  const { clientId } = req.user;
  const { title, name, age, ageUnit, gender, mobile, email, address } = req.body;
  if (!name) return res.status(400).json({ message: 'Patient name is required' });

  try {
    const patient = await findOrCreatePatient(clientId, { title, name, age, ageUnit, gender, mobile, email, address });
    return res.status(201).json(patient);
  } catch (err) {
    return res.status(400).json({ message: err.message });
  }
}

// PUT /api/patients/:id  - correcting a patient's own details (name, age,
// gender, mobile, email, address) after the fact, e.g. a typo caught after
// billing. The UMR itself is never editable here - it's the permanent
// medical record number carried across every visit.
async function updatePatient(req, res) {
  const { clientId } = req.user;
  const patient = await Patient.findOne({ where: { id: req.params.id, clientId } });
  if (!patient) return res.status(404).json({ message: 'Patient not found' });

  const { title, name, age, ageUnit, gender, mobile, email, address } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ message: 'Patient name is required' });
  if (mobile && mobile.length > 10) {
    return res.status(400).json({ message: 'Mobile number cannot be more than 10 digits' });
  }
  if (mobile) {
    const clash = await Patient.findOne({ where: { clientId, mobile, id: { [Op.ne]: patient.id } } });
    if (clash) return res.status(409).json({ message: `This mobile number already belongs to another patient (${clash.name}, ${clash.umr})` });
  }

  await patient.update({
    title: title || null,
    name: name.trim(),
    age: age === '' || age == null ? null : Number(age),
    ageUnit: ageUnit || 'Years',
    gender: gender || null,
    mobile: mobile || null,
    email: email || null,
    address: address || null,
  });
  return res.json(patient);
}

// GET /api/patients
async function listPatients(req, res) {
  const { clientId } = req.user;
  const { search } = req.query;
  const where = { clientId };
  if (search) where.name = { [Op.iLike]: `%${search}%` };

  const patients = await Patient.findAll({ where, order: [['createdAt', 'DESC']], limit: 100 });
  return res.json(patients);
}

// GET /api/patients/lookup?umr=...  or  ?mobile=...
async function lookupPatient(req, res) {
  const { clientId } = req.user;
  const { umr, mobile } = req.query;
  if (!umr && !mobile) return res.status(400).json({ message: 'Provide umr or mobile to look up' });

  const where = { clientId };
  if (umr) where.umr = umr;
  else where.mobile = mobile;

  const patient = await Patient.findOne({ where });
  if (!patient) return res.status(404).json({ message: 'No patient found' });
  return res.json(patient);
}

module.exports = { createPatient, updatePatient, listPatients, lookupPatient, findOrCreatePatient };

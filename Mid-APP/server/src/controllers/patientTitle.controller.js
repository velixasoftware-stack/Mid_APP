const { Op } = require('sequelize');
const { PatientTitle } = require('../models');

const GENDERS = ['Male', 'Female', 'Other'];

// Offered out of the box so the billing dropdown is never empty - Chief Admin
// can add more or delete these. Each one's gender is selected automatically
// in billing when the title is picked (null = gender left as is).
const DEFAULT_TITLES = [
  ['Mr.', 'Male'], ['Mrs.', 'Female'], ['Ms.', 'Female'], ['Miss', 'Female'],
  ['Master', 'Male'], ['Baby', null], ['Dr.', null],
];

async function seedDefaultPatientTitles() {
  if (await PatientTitle.count() === 0) {
    await PatientTitle.bulkCreate(DEFAULT_TITLES.map(([name, gender], i) => ({ name, gender, sequence: i + 1, createdBy: 'SYSTEM' })));
    return;
  }
  // Titles seeded before genders existed: give the default ones their gender,
  // once - only while it's still unset, so a Chief Admin's choice is kept.
  for (const [name, gender] of DEFAULT_TITLES) {
    if (gender) await PatientTitle.update({ gender }, { where: { name, gender: null, createdBy: 'SYSTEM' } });
  }
}

function parseGender(raw) {
  if (raw === undefined) return undefined;
  if (raw === null || raw === '') return null;
  return GENDERS.includes(raw) ? raw : false;
}

// GET /api/admin/masters/patient-titles (Chief Admin) and
// GET /api/patients/titles (client billing dropdown) - same list for both.
async function listPatientTitles(req, res) {
  const titles = await PatientTitle.findAll({ attributes: ['id', 'name', 'gender', 'sequence'], order: [['sequence', 'ASC'], ['name', 'ASC']] });
  return res.json(titles);
}

// POST /api/admin/masters/patient-titles  Body: { name, gender? }
async function createPatientTitle(req, res) {
  const name = req.body.name?.trim();
  if (!name) return res.status(400).json({ message: 'Title is required' });
  if (name.length > 20) return res.status(400).json({ message: 'Title cannot be more than 20 characters' });
  const gender = parseGender(req.body.gender);
  if (gender === false) return res.status(400).json({ message: `Gender must be one of: ${GENDERS.join(', ')}` });

  const existing = await PatientTitle.findOne({ where: { name: { [Op.iLike]: name } } });
  if (existing) return res.status(409).json({ message: `"${existing.name}" already exists` });

  const sequence = (await PatientTitle.max('sequence')) || 0;
  const title = await PatientTitle.create({ name, gender: gender ?? null, sequence: sequence + 1 });
  return res.status(201).json(title);
}

// PUT /api/admin/masters/patient-titles/:id  Body: { gender }
async function updatePatientTitle(req, res) {
  const title = await PatientTitle.findByPk(req.params.id);
  if (!title) return res.status(404).json({ message: 'Title not found' });
  const gender = parseGender(req.body.gender);
  if (gender === false) return res.status(400).json({ message: `Gender must be one of: ${GENDERS.join(', ')}` });
  if (gender !== undefined) await title.update({ gender });
  return res.json(title);
}

// DELETE /api/admin/masters/patient-titles/:id - patients already saved with
// this title keep it (Patient.title is plain text); it just stops being offered.
async function deletePatientTitle(req, res) {
  const deleted = await PatientTitle.destroy({ where: { id: req.params.id } });
  if (!deleted) return res.status(404).json({ message: 'Title not found' });
  return res.status(204).end();
}

module.exports = { seedDefaultPatientTitles, listPatientTitles, createPatientTitle, updatePatientTitle, deletePatientTitle };

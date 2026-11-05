const { Op } = require('sequelize');
const { ReferralDoctor } = require('../models');

// GET /api/doctors?search=name  - most recently used first, so the last doctor
// added/picked surfaces readily for the next patient too.
async function listDoctors(req, res) {
  const { clientId } = req.user;
  const { search } = req.query;
  const where = { clientId };
  if (search) where.name = { [Op.iLike]: `%${search}%` };

  const doctors = await ReferralDoctor.findAll({ where, order: [['lastUsedAt', 'DESC']], limit: 50 });
  return res.json(doctors);
}

/** Finds a doctor by name (case-insensitive) for this client, creating it if new, and bumps lastUsedAt. */
async function findOrCreateDoctor(clientId, name) {
  if (!name || !name.trim()) return null;
  const trimmed = name.trim();

  let doctor = await ReferralDoctor.findOne({ where: { clientId, name: { [Op.iLike]: trimmed } } });
  if (!doctor) {
    doctor = await ReferralDoctor.create({ clientId, name: trimmed, lastUsedAt: new Date() });
  } else {
    await doctor.update({ lastUsedAt: new Date() });
  }
  return doctor;
}

module.exports = { listDoctors, findOrCreateDoctor };

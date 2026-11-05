const { Op } = require('sequelize');
const { Announcement } = require('../models');

const TONES = ['info', 'warning', 'success'];

// "Today" as the clinics see it - India date, regardless of the server's own
// timezone (Render runs in UTC, which is still "yesterday" until 05:30 IST).
function todayIST() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
}

function validate(body) {
  const message = (body.message || '').toString().trim();
  if (!message) return { error: 'Caption text is required' };
  if (message.length > 500) return { error: 'Caption must be 500 characters or fewer' };
  const tone = TONES.includes(body.tone) ? body.tone : 'info';
  const fromDate = body.fromDate || null;
  const toDate = body.toDate || null;
  if (fromDate && toDate && toDate < fromDate) return { error: 'To date cannot be before From date' };
  return { value: { message, tone, active: body.active !== false, fromDate, toDate } };
}

// GET /api/announcements/active  (public - read by the client login page and app banner)
// Every active caption whose date window includes today; open-ended dates allowed.
async function listActive(_req, res) {
  const today = todayIST();
  const rows = await Announcement.findAll({
    where: {
      active: true,
      [Op.and]: [
        { [Op.or]: [{ fromDate: null }, { fromDate: { [Op.lte]: today } }] },
        { [Op.or]: [{ toDate: null }, { toDate: { [Op.gte]: today } }] },
      ],
    },
    attributes: ['id', 'message', 'tone', 'fromDate', 'toDate'],
    order: [['id', 'DESC']],
  });
  return res.json(rows);
}

// GET /api/announcements  (Chief Admin) - all captions, newest first, with today's
// date so the screen can show which ones are currently live.
async function list(_req, res) {
  const rows = await Announcement.findAll({ order: [['id', 'DESC']] });
  return res.json({ today: todayIST(), announcements: rows });
}

// POST /api/announcements  { message, tone?, active?, fromDate?, toDate? }
async function create(req, res) {
  const { error, value } = validate(req.body);
  if (error) return res.status(400).json({ message: error });
  const row = await Announcement.create({ ...value, createdBy: req.user?.username });
  return res.status(201).json(row);
}

// PUT /api/announcements/:id  - full edit, or just { active } to switch it on/off
async function update(req, res) {
  const row = await Announcement.findByPk(req.params.id);
  if (!row) return res.status(404).json({ message: 'Caption not found' });
  if (Object.keys(req.body).length === 1 && 'active' in req.body) {
    await row.update({ active: !!req.body.active, updatedBy: req.user?.username });
    return res.json(row);
  }
  const { error, value } = validate({ ...row.toJSON(), ...req.body });
  if (error) return res.status(400).json({ message: error });
  await row.update({ ...value, updatedBy: req.user?.username });
  return res.json(row);
}

// DELETE /api/announcements/:id
async function remove(req, res) {
  const row = await Announcement.findByPk(req.params.id);
  if (!row) return res.status(404).json({ message: 'Caption not found' });
  await row.destroy();
  return res.json({ message: 'Caption deleted' });
}

module.exports = { listActive, list, create, update, remove };

const { Client, ClientUser } = require('../models');
const { saveUpload } = require('../utils/fileStore');

// GET /api/clients/branding  (current client's report branding - separate
// from the clientName/address/mobile/email Chief Admin set at client
// creation; falls back to those only until this client sets its own)
async function getBranding(req, res) {
  const client = await Client.findByPk(req.user.clientId);
  return res.json({
    logoUrl: client.reportLogoPath || null,
    letterheadUrl: client.reportLetterheadPath || null,
    letterheadTopMm: client.reportTopMarginMm,
    letterheadBottomMm: client.reportBottomMarginMm,
    clientName: client.brandingName || client.clientName,
    address: client.brandingAddress || client.address,
    mobile: client.brandingMobile || client.mobile,
    email: client.brandingEmail || client.email,
  });
}

// POST /api/clients/branding  (multipart: logo, letterhead - either/both/neither -
// plus optional text fields clientName/address/mobile/email, all shown on the
// bill/report header so a clinic can keep its own patient-facing details
// current without needing Chief Admin to do it, and without touching the
// administrative clientName/address/mobile/email Chief Admin has on file)
async function uploadBranding(req, res) {
  const client = await Client.findByPk(req.user.clientId);
  const updates = {};

  if (req.files?.logo?.[0]) {
    updates.reportLogoPath = await saveUpload(client.id, 'logo', req.files.logo[0]);
  }
  if (req.files?.letterhead?.[0]) {
    updates.reportLetterheadPath = await saveUpload(client.id, 'letterhead', req.files.letterhead[0]);
  }
  const { clientName, address, mobile, email } = req.body;
  if (clientName !== undefined) {
    if (!clientName.trim()) return res.status(400).json({ message: 'Branding name cannot be empty' });
    updates.brandingName = clientName.trim();
  }
  if (address !== undefined) updates.brandingAddress = address.trim() || null;
  if (mobile !== undefined) updates.brandingMobile = mobile.trim() || null;
  if (email !== undefined) updates.brandingEmail = email.trim() || null;
  // Full-page letterhead margins (mm); blank = back to the report's default.
  for (const [field, column] of [['letterheadTopMm', 'reportTopMarginMm'], ['letterheadBottomMm', 'reportBottomMarginMm']]) {
    const raw = req.body[field];
    if (raw === undefined) continue;
    if (raw === '' || raw === null) { updates[column] = null; continue; }
    const mm = Number(raw);
    if (!Number.isInteger(mm) || mm < 0 || mm > 120) {
      return res.status(400).json({ message: 'Letterhead top/bottom space must be a whole number of mm between 0 and 120' });
    }
    updates[column] = mm;
  }

  if (Object.keys(updates).length === 0) {
    return res.status(400).json({ message: 'Nothing to update - choose a file or change a branding detail' });
  }

  await client.update(updates);
  return res.json({
    logoUrl: client.reportLogoPath || null,
    letterheadUrl: client.reportLetterheadPath || null,
    letterheadTopMm: client.reportTopMarginMm,
    letterheadBottomMm: client.reportBottomMarginMm,
    clientName: client.brandingName || client.clientName,
    address: client.brandingAddress || client.address,
    mobile: client.brandingMobile || client.mobile,
    email: client.brandingEmail || client.email,
  });
}

// GET /api/branding/doctors  (MANAGER) - this client's own staff, so the
// client can pick which of them needs a doctor signature/designation printed
// on the report footer whenever that user releases a report. Deliberately
// scoped to req.user.clientId only - never another client's users.
async function listDoctorUsers(req, res) {
  const users = await ClientUser.findAll({
    where: { clientId: req.user.clientId, isSystemUser: false },
    attributes: ['id', 'username', 'name', 'designation', 'signaturePath', 'signatureName'],
    order: [['name', 'ASC']],
  });
  return res.json(users);
}

// PUT /api/branding/doctors/:userId  Body: { designation, signatureName }
// signatureName is whatever name should print with the signature - any name
// at all, not necessarily this login's own account name.
async function setDoctorDesignation(req, res) {
  const user = await ClientUser.findOne({ where: { id: req.params.userId, clientId: req.user.clientId } });
  if (!user) return res.status(404).json({ message: 'User not found' });
  await user.update({
    designation: req.body.designation?.trim() || null,
    signatureName: req.body.signatureName?.trim() || null,
  });
  return res.json({ id: user.id, designation: user.designation, signatureName: user.signatureName });
}

// POST /api/branding/doctors/:userId/signature  (multipart: signature)
async function uploadDoctorSignature(req, res) {
  const user = await ClientUser.findOne({ where: { id: req.params.userId, clientId: req.user.clientId } });
  if (!user) return res.status(404).json({ message: 'User not found' });
  if (!req.file) return res.status(400).json({ message: 'A signature image file is required' });

  const signaturePath = await saveUpload(req.user.clientId, `signature-${user.id}`, req.file);
  await user.update({ signaturePath });
  return res.json({ signaturePath });
}

module.exports = { getBranding, uploadBranding, listDoctorUsers, setDoctorDesignation, uploadDoctorSignature };

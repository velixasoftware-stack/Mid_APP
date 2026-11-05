const bcrypt = require('bcryptjs');
const { ClientUser, Role, Client, ClientLocation } = require('../models');
const { calculatePlanAmount } = require('../utils/pricing');
const { isMarketingOnly } = require('../middleware/auth.middleware');

const { saveUpload } = require('../utils/fileStore');

async function resolveRoles(roleNames) {
  const roles = await Role.findAll({ where: { name: roleNames } });
  const found = new Set(roles.map((r) => r.name));
  const missing = roleNames.filter((name) => !found.has(name));
  if (missing.length) throw new Error(`Unknown role(s): ${missing.join(', ')}`);
  return roles;
}

/**
 * Reads the user's location access from the request body: locationId 'ALL'
 * (or empty) = every location, otherwise one of this client's locations.
 * Returns {} when the body doesn't mention it, { error } when it's invalid.
 */
async function locationAccess(clientId, body) {
  if (body.locationId === undefined) return {};
  if (body.locationId === 'ALL' || body.locationId === '' || body.locationId === null) {
    return { allLocations: true, locationId: null };
  }
  const location = await ClientLocation.findOne({ where: { id: Number(body.locationId) || 0, clientId } });
  if (!location) return { error: 'Selected location not found for this client' };
  if (!location.active) return { error: `${location.name} is inactive` };
  return { allLocations: false, locationId: location.id };
}

// POST /api/clients/:clientId/users  (Chief Admin or client ADMIN)
// Body: { username, password, name, email, mobile, department, designation, roleNames: ['FRONT_OFFICE', 'LAB_USER'] }
async function createUser(req, res) {
  const { clientId } = req.params;
  const { password, name, email, mobile, department, designation, roleNames } = req.body;
  const username = (req.body.username || '').toString().trim();
  const roleList = Array.isArray(roleNames) ? roleNames : (req.body.roleName ? [req.body.roleName] : []);

  if (!username || !password || roleList.length === 0) {
    return res.status(400).json({ message: 'username, password and at least one role are required' });
  }

  const client = await Client.findByPk(clientId);
  if (!client) return res.status(404).json({ message: 'Client not found' });

  let roles;
  try {
    roles = await resolveRoles(roleList);
  } catch (err) {
    return res.status(400).json({ message: err.message });
  }

  const existing = await ClientUser.findOne({ where: { clientId, username } });
  if (existing) return res.status(409).json({ message: 'Username already exists for this client' });
  const { error: locationError, ...access } = await locationAccess(clientId, req.body);
  if (locationError) return res.status(400).json({ message: locationError });

  const passwordHash = await bcrypt.hash(password, 10);
  const user = await ClientUser.create({ clientId, username, passwordHash, name, email, mobile, department, designation, ...access });
  await user.setRoles(roles);

  // Basic plan covers 2 users at ₹1500/month; each user beyond that adds ₹500/month,
  // plus this client's marketing person price (if any) stays included in the total.
  // Already-created subscription cycles keep their locked-in price - this only
  // affects future cycles.
  const userCount = await ClientUser.count({ where: { clientId, isSystemUser: false } });
  await client.update({ monthlyAmount: calculatePlanAmount(userCount) + Number(client.marketingPersonPrice || 0) });

  return res.status(201).json({ id: user.id, username: user.username, roles: roles.map((r) => r.name) });
}

// GET /api/clients/:clientId/users
async function listUsers(req, res) {
  const users = await ClientUser.findAll({
    where: { clientId: req.params.clientId },
    include: [Role],
    attributes: { exclude: ['passwordHash'] },
  });
  return res.json(users);
}

// PUT /api/clients/:clientId/users/:userId
// Body may include: { name, email, mobile, active, password, roleNames: [...] }
async function updateUser(req, res) {
  const user = await ClientUser.findOne({ where: { id: req.params.userId, clientId: req.params.clientId } });
  if (!user) return res.status(404).json({ message: 'User not found' });

  const { name, email, mobile, department, designation, active, roleNames, password } = req.body;
  const updates = { name, email, mobile, department, designation, active };
  const { error: locationError, ...access } = await locationAccess(user.clientId, req.body);
  if (locationError) return res.status(400).json({ message: locationError });
  Object.assign(updates, access);

  if (Array.isArray(roleNames)) {
    if (roleNames.length === 0) return res.status(400).json({ message: 'At least one role is required' });
    let roles;
    try {
      roles = await resolveRoles(roleNames);
    } catch (err) {
      return res.status(400).json({ message: err.message });
    }
    await user.setRoles(roles);
  }
  if (password) updates.passwordHash = await bcrypt.hash(password, 10);

  await user.update(updates);
  return res.json({ id: user.id, username: user.username });
}

// PUT /api/clients/:clientId/users/:userId/reset-password   Body: { password }
// Password only - nothing else about the user changes. Open to MARKETING for
// their assigned clients (checked by the route), but never for a client's
// auto-created "chiefadmin" support login - only an ADMIN may reset that.
async function resetUserPassword(req, res) {
  const user = await ClientUser.findOne({ where: { id: req.params.userId, clientId: req.params.clientId } });
  if (!user) return res.status(404).json({ message: 'User not found' });
  if (user.isSystemUser && isMarketingOnly(req)) {
    return res.status(403).json({ message: 'The Chief Admin support login can only be reset by an Admin' });
  }
  const password = (req.body.password || '').toString();
  if (password.length < 4) return res.status(400).json({ message: 'Password must be at least 4 characters' });
  await user.update({ passwordHash: await bcrypt.hash(password, 10) });
  return res.json({ id: user.id, username: user.username });
}

// POST /api/clients/:clientId/users/:userId/signature  (multipart: signature)
async function uploadSignature(req, res) {
  const user = await ClientUser.findOne({ where: { id: req.params.userId, clientId: req.params.clientId } });
  if (!user) return res.status(404).json({ message: 'User not found' });
  if (!req.file) return res.status(400).json({ message: 'A signature image file is required' });

  const signaturePath = await saveUpload(req.params.clientId, `signature-${user.id}`, req.file);
  await user.update({ signaturePath });
  return res.json({ signaturePath });
}

module.exports = { createUser, listUsers, updateUser, uploadSignature, resetUserPassword };

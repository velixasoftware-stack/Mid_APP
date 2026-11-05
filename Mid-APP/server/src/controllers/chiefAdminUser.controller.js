const bcrypt = require('bcryptjs');
const { ChiefAdmin, Role, sequelize } = require('../models');
const { ALL_CHIEF_ADMIN_ROLES } = require('../utils/roles');

async function resolveRoles(roleNames) {
  const invalid = roleNames.filter((name) => !ALL_CHIEF_ADMIN_ROLES.includes(name));
  if (invalid.length) throw new Error(`Unknown Chief Admin role(s): ${invalid.join(', ')}`);
  return Role.findAll({ where: { name: roleNames } });
}

// POST /api/chief-admin-users  (Chief Admin, ADMIN role only)
// Body: { username, password, name, roleNames: ['ADMIN' | 'MARKETING', ...] }
async function createChiefAdminUser(req, res) {
  const { username, password, name, roleNames } = req.body;
  const roleList = Array.isArray(roleNames) ? roleNames : [];

  if (!username || !password || roleList.length === 0) {
    return res.status(400).json({ message: 'username, password and at least one role are required' });
  }

  const existing = await ChiefAdmin.findOne({ where: { username } });
  if (existing) return res.status(409).json({ message: 'Username already exists' });

  let roles;
  try {
    roles = await resolveRoles(roleList);
  } catch (err) {
    return res.status(400).json({ message: err.message });
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const admin = await ChiefAdmin.create({ username, passwordHash, name });
  await admin.setRoles(roles);

  return res.status(201).json({ id: admin.id, username: admin.username, roles: roles.map((r) => r.name) });
}

// POST /api/chief-admin-users/bulk  (Chief Admin, ADMIN role only)
// Body: { users: [{ username, password, name, roleNames: [...] }, ...] }
async function createChiefAdminUsersBulk(req, res) {
  const users = Array.isArray(req.body.users) ? req.body.users : [];
  if (users.length === 0) return res.status(400).json({ message: 'users array is required' });

  for (const u of users) {
    const roleList = Array.isArray(u.roleNames) ? u.roleNames : [];
    u.roleNames = roleList;
    if (!u.username || !u.password || roleList.length === 0) {
      return res.status(400).json({ message: 'Each user needs a username, password and at least one role' });
    }
  }

  const usernames = users.map((u) => u.username);
  const dupInBatch = usernames.filter((name, i) => usernames.indexOf(name) !== i);
  if (dupInBatch.length) {
    return res.status(400).json({ message: `Duplicate username(s) in this batch: ${[...new Set(dupInBatch)].join(', ')}` });
  }
  const existing = await ChiefAdmin.findAll({ where: { username: usernames }, attributes: ['username'] });
  if (existing.length) {
    return res.status(409).json({ message: `Username(s) already exist: ${existing.map((e) => e.username).join(', ')}` });
  }

  try {
    const created = await sequelize.transaction(async (t) => {
      const results = [];
      for (const u of users) {
        const roles = await resolveRoles(u.roleNames);
        const passwordHash = await bcrypt.hash(u.password, 10);
        const admin = await ChiefAdmin.create({ username: u.username, passwordHash, name: u.name }, { transaction: t });
        await admin.setRoles(roles, { transaction: t });
        results.push({ id: admin.id, username: admin.username, roles: roles.map((r) => r.name) });
      }
      return results;
    });
    return res.status(201).json({ users: created });
  } catch (err) {
    return res.status(400).json({ message: err.message || 'Failed to create users' });
  }
}

// GET /api/chief-admin-users
async function listChiefAdminUsers(req, res) {
  const admins = await ChiefAdmin.findAll({
    include: [Role],
    attributes: { exclude: ['passwordHash'] },
    order: [['createdAt', 'ASC']],
  });
  return res.json(admins);
}

// PUT /api/chief-admin-users/:id
// Body may include: { name, active, password, roleNames: [...] }
async function updateChiefAdminUser(req, res) {
  const admin = await ChiefAdmin.findByPk(req.params.id);
  if (!admin) return res.status(404).json({ message: 'Chief Admin user not found' });

  const { name, active, password, roleNames } = req.body;
  const updates = { name, active };

  if (Array.isArray(roleNames)) {
    if (roleNames.length === 0) return res.status(400).json({ message: 'At least one role is required' });
    let roles;
    try {
      roles = await resolveRoles(roleNames);
    } catch (err) {
      return res.status(400).json({ message: err.message });
    }
    await admin.setRoles(roles);
  }
  if (password) updates.passwordHash = await bcrypt.hash(password, 10);

  await admin.update(updates);
  return res.json({ id: admin.id, username: admin.username });
}

// PUT /api/chief-admin-users/:id/reset-password  (Chief Admin, ADMIN or MARKETING role)
// Body: { password }. Deliberately narrower than updateChiefAdminUser - it only
// ever touches the password, never roles or active status.
async function resetPassword(req, res) {
  const admin = await ChiefAdmin.findByPk(req.params.id);
  if (!admin) return res.status(404).json({ message: 'Chief Admin user not found' });

  const { password } = req.body;
  if (!password) return res.status(400).json({ message: 'A new password is required' });

  await admin.update({ passwordHash: await bcrypt.hash(password, 10) });
  return res.json({ id: admin.id, username: admin.username });
}

module.exports = {
  createChiefAdminUser, createChiefAdminUsersBulk, listChiefAdminUsers, updateChiefAdminUser, resetPassword,
};

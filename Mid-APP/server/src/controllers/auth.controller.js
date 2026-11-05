const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { Op } = require('sequelize');
const { ChiefAdmin, Client, ClientUser, Role } = require('../models');
const { signToken } = require('../utils/jwt');
const { syncClientPaymentStatus } = require('./subscription.controller');
const { createInitialSubscription, generateClientCode, mintSystemUserSession } = require('./client.controller');
const { calculatePlanAmount } = require('../utils/pricing');
const { sendEmail, sendWhatsApp, getTemplate, renderTemplate } = require('../utils/notify');
const { activeLocations, resolveLoginLocation, locationInfo } = require('../utils/location');

// POST /api/auth/chief-admin/login
async function chiefAdminLogin(req, res) {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ message: 'username and password are required' });
  }

  // Case-insensitive: "Karthik" and "karthik" are the same login.
  const admin = await ChiefAdmin.findOne({ where: { username: { [Op.iLike]: username } }, include: [Role] });
  if (!admin || !admin.active || !(await bcrypt.compare(password, admin.passwordHash))) {
    return res.status(401).json({ message: 'Invalid credentials' });
  }

  const roles = admin.Roles.map((r) => r.name);
  // A fresh session id evicts any session already active elsewhere for this
  // account - see the comparison in auth.middleware.js.
  const sessionId = crypto.randomUUID();
  await admin.update({ currentSessionId: sessionId });
  const token = signToken({ type: 'CHIEF_ADMIN', id: admin.id, username: admin.username, roles, sessionId });
  return res.json({
    token,
    user: { id: admin.id, username: admin.username, name: admin.name, roles, type: 'CHIEF_ADMIN' },
  });
}

// GET /api/auth/locations?clientCode=  (public - the login screen's Location
// dropdown). Lists locations only when the client has more than one.
async function listLoginLocations(req, res) {
  const clientCode = (req.query.clientCode || '').toString().trim();
  if (!clientCode) return res.json([]);
  const client = await Client.findOne({ where: { clientCode: { [Op.iLike]: clientCode } }, attributes: ['id', 'active'] });
  if (!client || !client.active) return res.json([]);
  const locations = await activeLocations(client.id);
  return res.json(locations.length > 1 ? locations.map((l) => ({ id: l.id, name: l.name, isMain: l.isMain })) : []);
}

// POST /api/auth/login  { clientCode, username, password, locationId }
// locationId is needed only when the client has more than one location.
async function clientUserLogin(req, res) {
  const { clientCode, username, password, locationId } = req.body;
  if (!clientCode || !username || !password) {
    return res.status(400).json({ message: 'clientCode, username and password are required' });
  }

  // Case-insensitive: clientCode and username shouldn't trip people up over capitalization.
  const client = await Client.findOne({ where: { clientCode: { [Op.iLike]: clientCode } } });
  if (!client || !client.active) {
    return res.status(401).json({ message: 'Invalid client code' });
  }

  const user = await ClientUser.findOne({
    where: { clientId: client.id, username: { [Op.iLike]: username } },
    include: [Role],
  });
  const userOk = user && user.active && (await bcrypt.compare(password, user.passwordHash));

  if (!userOk) {
    // Fallback: a Chief Admin (ADMIN role) can log into ANY client's app
    // using their own existing Chief Admin username/password, with that
    // client's Client Code - no need to know/reset that specific client's
    // separate chiefadmin support password. Reuses the same auto-provisioned
    // support ClientUser the Chief Admin dashboard's "Open as this client"
    // button opens, so it's the same one account either way.
    const chiefAdmin = await ChiefAdmin.findOne({ where: { username: { [Op.iLike]: username } }, include: [Role] });
    const chiefAdminOk = chiefAdmin && chiefAdmin.active && (await bcrypt.compare(password, chiefAdmin.passwordHash));
    // ADMIN may do this for any client; MARKETING only for clients assigned to them.
    const isAdmin = chiefAdminOk && chiefAdmin.Roles.some((r) => r.name === 'ADMIN');
    const isAssignedMarketing = chiefAdminOk && chiefAdmin.Roles.some((r) => r.name === 'MARKETING')
      && (client.salesPerson || '').toLowerCase() === chiefAdmin.username.toLowerCase();
    if (isAdmin || isAssignedMarketing) {
      const session = await mintSystemUserSession(client, locationId);
      if (session.error) return res.status(400).json({ message: session.error });
      console.log(`Chief Admin "${chiefAdmin.username}" logged into client ${client.clientCode} (${client.clientName}) using their own credentials.`);
      return res.json(session);
    }
    return res.status(401).json({ message: 'Invalid credentials' });
  }

  const { location, error: locationError } = await resolveLoginLocation(client.id, user, locationId);
  if (locationError) return res.status(400).json({ message: locationError });

  const roles = user.Roles.map((r) => r.name);

  // A fresh session id evicts any session already active elsewhere for this
  // account - see the comparison in auth.middleware.js.
  const sessionId = crypto.randomUUID();
  await user.update({ currentSessionId: sessionId });

  const token = signToken({
    type: 'CLIENT_USER',
    id: user.id,
    clientId: client.id,
    clientCode: client.clientCode,
    roles,
    sessionId,
    locationId: location?.id || null,
  });

  // Re-derive from the subscription's Start Date/End Date so a lapsed window
  // shows up immediately at login, not just on the next protected request.
  const paymentStatus = await syncClientPaymentStatus(client.id);

  return res.json({
    token,
    user: {
      id: user.id,
      username: user.username,
      name: user.name,
      roles,
      type: 'CLIENT_USER',
    },
    client: {
      id: client.id,
      clientCode: client.clientCode,
      clientName: client.clientName,
      paymentStatus,
      allowBillCancellationRefund: client.allowBillCancellationRefund,
      qrPaymentRequired: client.qrPaymentRequired,
      ...(await locationInfo(client.id, location)),
    },
  });
}


// POST /api/auth/self-register  (public - a lab signs itself up, no Chief Admin involved)
// Body: { clientName, mobile, email, address, adminUsername, adminPassword, adminName }
// The Client Code is generated by the server, never chosen by the signer-upper.
async function selfRegister(req, res) {
  const { clientName, mobile, email, address, adminUsername, adminPassword, adminName } = req.body;

  if (!clientName || !adminUsername || !adminPassword) {
    return res.status(400).json({ message: 'clientName, adminUsername and adminPassword are required' });
  }
  if (!email && !mobile) {
    return res.status(400).json({ message: 'Provide at least an email or a WhatsApp/mobile number so we can send your login details' });
  }

  const clientCode = await generateClientCode('SELF_SIGNUP');
  const adminRole = await Role.findOne({ where: { name: 'ADMIN' } });
  // A self-signup starts with just its one owner/admin account - the basic
  // plan (up to 2 users) applies, same as any other client.
  const monthlyAmount = calculatePlanAmount(1);

  const client = await Client.create({
    clientCode, clientName, mobile, email, address, monthlyAmount, paymentStatus: 'PENDING',
  });
  await createInitialSubscription(client);

  const passwordHash = await bcrypt.hash(adminPassword, 10);
  const user = await ClientUser.create({ clientId: client.id, username: adminUsername, passwordHash, name: adminName });
  await user.setRoles([adminRole]);

  const loginDetailsText = `Client Code: ${clientCode}\nUsername: ${adminUsername}\n\nLog in and complete your monthly payment to activate full access.`;
  const templateData = { clientCode, clientName, username: adminUsername, name: adminName || adminUsername, loginDetails: loginDetailsText };
  const welcomeTemplate = await getTemplate('CLIENT_WELCOME');

  const emailSubject = welcomeTemplate ? renderTemplate(welcomeTemplate.header, templateData) : 'Your HMS / LIMS account has been created';
  const emailBody = welcomeTemplate
    ? renderTemplate(welcomeTemplate.description, templateData).replace(/\n/g, '<br/>')
    : `<p>Hello ${adminName || adminUsername},</p><p>Your account is ready. Here are your login details:</p><pre>${loginDetailsText}</pre>`;
  const whatsappMessage = welcomeTemplate
    ? `${renderTemplate(welcomeTemplate.header, templateData)}\n${renderTemplate(welcomeTemplate.description, templateData)}`
    : `Your HMS/LIMS account is ready!\n${loginDetailsText}`;

  sendEmail({
    to: email,
    subject: emailSubject,
    html: emailBody,
  }).catch((err) => console.error('selfRegister email notify failed:', err.message));
  sendWhatsApp({
    to: mobile,
    message: whatsappMessage,
  }).catch((err) => console.error('selfRegister whatsapp notify failed:', err.message));

  return res.status(201).json({ clientCode, username: adminUsername });
}

/**
 * Self-service password change, shared by every logged-in account (Chief
 * Admin staff and every Client role) - always requires the current password,
 * unlike the ADMIN/MARKETING-initiated resets elsewhere which don't.
 */
// PUT /api/auth/change-password  (any authenticated account)
// Body: { currentPassword, newPassword }
async function changeOwnPassword(req, res) {
  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword) {
    return res.status(400).json({ message: 'currentPassword and newPassword are required' });
  }

  const Model = req.user.type === 'CHIEF_ADMIN' ? ChiefAdmin : ClientUser;
  const account = await Model.findByPk(req.user.id);
  if (!account || !(await bcrypt.compare(currentPassword, account.passwordHash))) {
    return res.status(401).json({ message: 'Current password is incorrect' });
  }

  await account.update({ passwordHash: await bcrypt.hash(newPassword, 10) });
  return res.json({ message: 'Password updated.' });
}

// POST /api/auth/logout  (any authenticated account)
// Clears the account's current session id so its token can no longer pass
// the single-session check in auth.middleware.js, even before it expires.
async function logout(req, res) {
  const Model = req.user.type === 'CHIEF_ADMIN' ? ChiefAdmin : ClientUser;
  await Model.update({ currentSessionId: null }, { where: { id: req.user.id } });
  return res.json({ message: 'Logged out.' });
}

module.exports = { chiefAdminLogin, clientUserLogin, listLoginLocations, selfRegister, changeOwnPassword, logout };

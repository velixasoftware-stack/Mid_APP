require('dotenv').config();
const bcrypt = require('bcryptjs');
const { sequelize, ChiefAdmin, Role, TestMaster, ParameterMaster, Client, ClientUser } = require('./models');
const { ROLES, ALL_ROLES, ALL_CHIEF_ADMIN_ROLES, CHIEF_ADMIN_ROLES } = require('./utils/roles');
const { createInitialSubscription } = require('./controllers/client.controller');

async function seed() {
  await sequelize.sync();

  // Roles (client-side and Chief-Admin-side roles share the same Role table)
  for (const name of new Set([...ALL_ROLES, ...ALL_CHIEF_ADMIN_ROLES])) {
    await Role.findOrCreate({ where: { name } });
  }
  console.log('Roles ready:', ALL_ROLES.join(', '), '/', ALL_CHIEF_ADMIN_ROLES.join(', '));

  // Chief Admin (defaults to the ADMIN role - full access)
  const username = process.env.CHIEF_ADMIN_USERNAME || 'chiefadmin';
  const password = process.env.CHIEF_ADMIN_PASSWORD || 'ChangeMe@123';
  const adminRole = await Role.findOne({ where: { name: CHIEF_ADMIN_ROLES.ADMIN } });
  let chiefAdmin = await ChiefAdmin.findOne({ where: { username } });
  if (!chiefAdmin) {
    const passwordHash = await bcrypt.hash(password, 10);
    chiefAdmin = await ChiefAdmin.create({ username, passwordHash, name: 'Chief Admin' });
    console.log(`Chief Admin created: ${username} / ${password}`);
  } else {
    console.log('Chief Admin already exists, skipping.');
  }
  await chiefAdmin.setRoles([adminRole]);

  // Sample Test Master data (from the requirements doc)
  const sampleTests = [
    { testCode: 'CBC001', testName: 'Complete Blood Count', parameters: [
      { parameterName: 'Hemoglobin', unit: 'g/dL', normalRangeLow: '13', normalRangeHigh: '17' },
      { parameterName: 'WBC Count', unit: '/cumm', normalRangeLow: '4000', normalRangeHigh: '11000' },
    ] },
    { testCode: 'GLU001', testName: 'Glucose', parameters: [
      { parameterName: 'Glucose', unit: 'mg/dL', normalRangeLow: '70', normalRangeHigh: '110' },
    ] },
    { testCode: 'LFT001', testName: 'Liver Function Test', parameters: [
      { parameterName: 'SGPT', unit: 'U/L', normalRangeLow: '7', normalRangeHigh: '56' },
      { parameterName: 'SGOT', unit: 'U/L', normalRangeLow: '5', normalRangeHigh: '40' },
    ] },
  ];
  for (const t of sampleTests) {
    const [test] = await TestMaster.findOrCreate({ where: { testCode: t.testCode }, defaults: { testName: t.testName } });
    for (const p of t.parameters) {
      await ParameterMaster.findOrCreate({ where: { testId: test.id, parameterName: p.parameterName }, defaults: p });
    }
  }
  console.log('Sample Test Master + Parameters ready.');

  // Demo client + one user per role, so the app can be exercised immediately.
  const [client] = await Client.findOrCreate({
    where: { clientCode: 'DEMO001' },
    defaults: {
      clientName: 'ABC Diagnostics',
      mobile: '9999999999',
      email: 'demo@abcdiagnostics.test',
      salesPerson: 'N/A',
      monthlyAmount: 5000,
      paymentStatus: 'PENDING',
    },
  });
  await createInitialSubscription(client);

  const demoUsers = [
    { username: 'admin', roles: [ROLES.ADMIN] },
    { username: 'frontoffice', roles: [ROLES.FRONT_OFFICE] },
    { username: 'labuser', roles: [ROLES.LAB_USER] },
    { username: 'manager', roles: [ROLES.MANAGER] },
    { username: 'mastermanager', roles: [ROLES.MASTER_MANAGER] },
    // Demonstrates a single user holding multiple roles at once.
    { username: 'multiuser', roles: [ROLES.FRONT_OFFICE, ROLES.LAB_USER] },
  ];
  const demoPassword = 'Demo@123';
  for (const u of demoUsers) {
    const roles = await Role.findAll({ where: { name: u.roles } });
    let user = await ClientUser.findOne({ where: { clientId: client.id, username: u.username } });
    if (!user) {
      const passwordHash = await bcrypt.hash(demoPassword, 10);
      user = await ClientUser.create({ clientId: client.id, username: u.username, passwordHash, name: u.username });
    }
    await user.setRoles(roles);
  }
  console.log(`Demo client DEMO001 ready with users [${demoUsers.map((u) => u.username).join(', ')}] password "${demoPassword}".`);

  // Demo Chief-Admin-side Marketing user, so the ADMIN vs MARKETING split can be tried immediately.
  const marketingRole = await Role.findOne({ where: { name: CHIEF_ADMIN_ROLES.MARKETING } });
  const existingMarketing = await ChiefAdmin.findOne({ where: { username: 'marketing' } });
  if (!existingMarketing) {
    const passwordHash = await bcrypt.hash('Marketing@123', 10);
    const marketingUser = await ChiefAdmin.create({ username: 'marketing', passwordHash, name: 'Marketing User' });
    await marketingUser.setRoles([marketingRole]);
    console.log('Chief-Admin Marketing user created: marketing / Marketing@123');
  }

  await sequelize.close();
}

seed().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});

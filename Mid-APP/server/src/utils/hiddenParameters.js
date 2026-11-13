// Universal parameters a clinic has removed from a test for itself only
// (ClientHiddenParameter) - see models/index.js.
const { ClientHiddenParameter } = require('../models');

const hiddenKey = (testId, parameterId) => `${testId}:${parameterId}`;

/** Set of "testId:parameterId" this client has hidden. Empty for Chief Admin (no client). */
async function hiddenParameterKeys(clientId) {
  if (!clientId) return new Set();
  const rows = await ClientHiddenParameter.findAll({ where: { clientId }, attributes: ['testId', 'parameterId'], raw: true });
  return new Set(rows.map((r) => hiddenKey(r.testId, r.parameterId)));
}

module.exports = { hiddenKey, hiddenParameterKeys };

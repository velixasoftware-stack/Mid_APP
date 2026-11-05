// Whether a client may bill a test, given its ClientTestPrice row and the
// shared TestMaster: the clinic's own switch must be Active, and Chief Admin
// must have the test Active - unless the clinic overrode Chief Admin's
// Inactive for itself (ClientTestPrice.overrideChiefInactive).
function isBillableForClient(priceRow, test) {
  if (!priceRow || !priceRow.active) return false;
  return !!(test?.active || priceRow.overrideChiefInactive);
}

module.exports = { isBillableForClient };

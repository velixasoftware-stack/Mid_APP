const { sequelize, ClientLocation, ClientLocationTestPrice } = require('../models');

/** A client's active locations, Main first. */
function activeLocations(clientId) {
  return ClientLocation.findAll({
    where: { clientId, active: true },
    order: [['isMain', 'DESC'], ['name', 'ASC']],
  });
}

/**
 * The location a login works at, checked against the user's own access.
 * With one location (or none) nothing is picked - that one is used. With
 * several, the login screen's pick is required; a single-location user may
 * only pick their own. `user` null = Chief Admin support login (all locations).
 * Returns { location } (null when the client has no locations) or { error }.
 */
async function resolveLoginLocation(clientId, user, requestedId) {
  const locations = await activeLocations(clientId);
  if (locations.length === 0) return { location: null };
  const own = user && !user.allLocations && user.locationId ? user.locationId : null;
  if (own && !locations.some((l) => l.id === own)) {
    return { error: 'Your location is inactive. Please contact your admin.' };
  }
  if (locations.length === 1) {
    return own && own !== locations[0].id ? { error: 'Your location is inactive. Please contact your admin.' } : { location: locations[0] };
  }
  const picked = locations.find((l) => l.id === Number(requestedId));
  if (!picked) return { error: 'Select a location' };
  if (own && picked.id !== own) {
    const ownName = locations.find((l) => l.id === own)?.name;
    return { error: `This user can log in only at ${ownName}` };
  }
  return { location: picked };
}

/**
 * Where-clause part that limits a list (bills, samples) to the location a
 * single-location user works at. All-location users see every location.
 */
function locationWhere(req) {
  return req.user?.locationFilter ? { locationId: req.user.locationFilter } : {};
}

/** The location new bills go to: this session's, else the client's Main one. */
async function sessionLocationId(req) {
  if (req.user?.locationId) return req.user.locationId;
  const main = await ClientLocation.findOne({ where: { clientId: req.user.clientId, isMain: true }, attributes: ['id'] });
  return main?.id || null;
}

/**
 * Swaps each ClientTestPrice row's price for the location's own price where
 * it has one. Main (or no location) keeps the client's prices as they are.
 */
async function applyLocationPrices(rows, locationId) {
  if (!locationId || rows.length === 0) return rows;
  const location = await ClientLocation.findByPk(locationId, { attributes: ['id', 'isMain'] });
  if (!location || location.isMain) return rows;
  const own = await ClientLocationTestPrice.findAll({ where: { locationId, testId: rows.map((r) => r.testId) } });
  const priceByTestId = new Map(own.map((p) => [p.testId, p.price]));
  for (const row of rows) {
    if (priceByTestId.has(row.testId)) row.setDataValue('price', priceByTestId.get(row.testId));
  }
  return rows;
}

/** Location details for the session's client object (header, prices screen). */
async function locationInfo(clientId, location) {
  const count = (await activeLocations(clientId)).length;
  return { locationId: location?.id || null, locationName: location?.name || null, multiLocation: count > 1 };
}

/** Bills/samples made before the client had locations move to its Main location. */
async function backfillMainLocation(clientId, mainId) {
  for (const table of ['bill', 'sample']) {
    await sequelize.query(`UPDATE ${table} SET "locationId" = :mainId WHERE "clientId" = :clientId AND "locationId" IS NULL`, {
      replacements: { mainId, clientId },
    });
  }
}

module.exports = {
  activeLocations, resolveLoginLocation, locationWhere, sessionLocationId, applyLocationPrices, backfillMainLocation, locationInfo,
};

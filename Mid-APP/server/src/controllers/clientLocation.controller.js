const { Op } = require('sequelize');
const { Client, ClientLocation } = require('../models');
const { activeLocations, backfillMainLocation } = require('../utils/location');

// GET /api/clients/:clientId/locations  (Chief Admin - active and inactive)
async function listLocations(req, res) {
  const locations = await ClientLocation.findAll({
    where: { clientId: req.params.clientId },
    order: [['isMain', 'DESC'], ['name', 'ASC']],
  });
  return res.json(locations);
}

// POST /api/clients/:clientId/locations  { name, address }
// The client's first location becomes its Main location, and every bill made
// before it is counted under it.
async function createLocation(req, res) {
  const { clientId } = req.params;
  const name = (req.body.name || '').toString().trim();
  const address = (req.body.address || '').toString().trim() || null;
  if (!name) return res.status(400).json({ message: 'Location name is required' });

  const client = await Client.findByPk(clientId);
  if (!client) return res.status(404).json({ message: 'Client not found' });
  const clash = await ClientLocation.findOne({ where: { clientId, name: { [Op.iLike]: name } } });
  if (clash) return res.status(409).json({ message: `A location named ${clash.name} already exists for this client` });

  const isMain = (await ClientLocation.count({ where: { clientId } })) === 0;
  const location = await ClientLocation.create({ clientId, name, address, isMain });
  if (isMain) await backfillMainLocation(client.id, location.id);
  return res.status(201).json(location);
}

// PUT /api/clients/:clientId/locations/:locationId  { name, address, active }
// The Main location can't be switched off - its prices are the client's own.
async function updateLocation(req, res) {
  const { clientId, locationId } = req.params;
  const location = await ClientLocation.findOne({ where: { id: locationId, clientId } });
  if (!location) return res.status(404).json({ message: 'Location not found' });

  const updates = {};
  if (req.body.name !== undefined) {
    const name = (req.body.name || '').toString().trim();
    if (!name) return res.status(400).json({ message: 'Location name is required' });
    const clash = await ClientLocation.findOne({ where: { clientId, name: { [Op.iLike]: name }, id: { [Op.ne]: location.id } } });
    if (clash) return res.status(409).json({ message: `A location named ${clash.name} already exists for this client` });
    updates.name = name;
  }
  if (req.body.address !== undefined) updates.address = (req.body.address || '').toString().trim() || null;
  if (req.body.active !== undefined) {
    if (typeof req.body.active !== 'boolean') return res.status(400).json({ message: 'active must be true or false' });
    if (!req.body.active && location.isMain) return res.status(400).json({ message: 'The Main location cannot be made inactive' });
    updates.active = req.body.active;
  }
  await location.update(updates);
  return res.json(location);
}

// GET /api/locations  (client staff) - this client's active locations, the
// one this session works at, and whether this user is held to it.
async function listMyLocations(req, res) {
  if (req.user.type !== 'CLIENT_USER') return res.status(403).json({ message: 'Client login required' });
  const locations = await activeLocations(req.user.clientId);
  return res.json({
    locations: locations.map((l) => ({ id: l.id, name: l.name, isMain: l.isMain })),
    currentLocationId: req.user.locationId || locations[0]?.id || null,
    restrictedTo: req.user.locationFilter || null,
  });
}

module.exports = { listLocations, createLocation, updateLocation, listMyLocations };

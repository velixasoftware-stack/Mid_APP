const { NotificationTemplate } = require('../models');

// GET /api/notification-templates
async function listTemplates(req, res) {
  const templates = await NotificationTemplate.findAll({ order: [['createdAt', 'ASC']] });
  return res.json(templates);
}

// POST /api/notification-templates
async function createTemplate(req, res) {
  const { name, channel, header, description } = req.body;
  if (!name || !header || !description) {
    return res.status(400).json({ message: 'name, header and description are required' });
  }
  const existing = await NotificationTemplate.findOne({ where: { name } });
  if (existing) return res.status(409).json({ message: 'A template with this name already exists' });

  const template = await NotificationTemplate.create({
    name, channel: channel || 'BOTH', header, description,
  });
  return res.status(201).json(template);
}

// PUT /api/notification-templates/:id
async function updateTemplate(req, res) {
  const template = await NotificationTemplate.findByPk(req.params.id);
  if (!template) return res.status(404).json({ message: 'Template not found' });

  const { channel, header, description, active } = req.body;
  await template.update({
    channel: channel ?? template.channel,
    header: header ?? template.header,
    description: description ?? template.description,
    active: active ?? template.active,
  });
  return res.json(template);
}

// DELETE /api/notification-templates/:id
async function deleteTemplate(req, res) {
  const template = await NotificationTemplate.findByPk(req.params.id);
  if (!template) return res.status(404).json({ message: 'Template not found' });
  await template.destroy();
  return res.status(204).send();
}

module.exports = { listTemplates, createTemplate, updateTemplate, deleteTemplate };

const { sequelize, Client } = require('../models');

// Chief Admin > Client Data Reset: one client's data, by area, so test/demo
// data can be cleared before going live (or a clinic can start over) without
// touching any other client. Every query is scoped to that client's id.
//
// Each area lists what it counts, what a backup exports and what a reset
// deletes (in order - children first; the rest go by ON DELETE CASCADE).
// `needsBills`: removing this area while the client still has bills would
// strip those bills of their patient / payor / doctor / parameter, so it can
// only be removed together with Bills & Lab Work.
const AREAS = [
  {
    key: 'bills',
    label: 'Bills & Lab Work',
    description: 'Bills (with billed tests, discounts, due payments, refunds), samples, results, reports and payor invoices.',
    counts: {
      Bills: 'SELECT count(*) FROM bill WHERE "clientId" = :c',
      'Billed tests': 'SELECT count(*) FROM bill_item bi JOIN bill b ON b.id = bi."billId" WHERE b."clientId" = :c',
      Samples: 'SELECT count(*) FROM sample WHERE "clientId" = :c',
      Results: 'SELECT count(*) FROM result r JOIN sample s ON s.id = r."sampleId" WHERE s."clientId" = :c',
      Reports: 'SELECT count(*) FROM report r JOIN sample s ON s.id = r."sampleId" WHERE s."clientId" = :c',
      'Payor invoices': 'SELECT count(*) FROM payor_invoice WHERE "clientId" = :c',
    },
    exports: {
      bill: 'SELECT * FROM bill WHERE "clientId" = :c',
      bill_item: 'SELECT bi.* FROM bill_item bi JOIN bill b ON b.id = bi."billId" WHERE b."clientId" = :c',
      bill_discount: 'SELECT x.* FROM bill_discount x JOIN bill b ON b.id = x."billId" WHERE b."clientId" = :c',
      due_payment: 'SELECT x.* FROM due_payment x JOIN bill b ON b.id = x."billId" WHERE b."clientId" = :c',
      refund: 'SELECT x.* FROM refund x JOIN bill b ON b.id = x."billId" WHERE b."clientId" = :c',
      sample: 'SELECT * FROM sample WHERE "clientId" = :c',
      result: 'SELECT r.* FROM result r JOIN sample s ON s.id = r."sampleId" WHERE s."clientId" = :c',
      report: 'SELECT r.* FROM report r JOIN sample s ON s.id = r."sampleId" WHERE s."clientId" = :c',
      payor_invoice: 'SELECT * FROM payor_invoice WHERE "clientId" = :c',
      payor_invoice_item: 'SELECT x.* FROM payor_invoice_item x JOIN payor_invoice i ON i.id = x."payorInvoiceId" WHERE i."clientId" = :c',
      payor_invoice_collection: 'SELECT x.* FROM payor_invoice_collection x JOIN payor_invoice i ON i.id = x."payorInvoiceId" WHERE i."clientId" = :c',
    },
    deletes: [
      'DELETE FROM payor_invoice WHERE "clientId" = :c', // + its items and collections
      'DELETE FROM sample WHERE "clientId" = :c', // + results and reports
      'DELETE FROM bill WHERE "clientId" = :c', // + billed tests, discounts, due payments, refunds
    ],
  },
  {
    key: 'patients',
    label: 'Patients',
    description: 'Registered patients (UMR numbers start again from UMR000001).',
    needsBills: true,
    counts: { Patients: 'SELECT count(*) FROM patient WHERE "clientId" = :c' },
    exports: { patient: 'SELECT * FROM patient WHERE "clientId" = :c' },
    deletes: ['DELETE FROM patient WHERE "clientId" = :c'],
  },
  {
    key: 'prices',
    label: 'Test Prices, Short Names & Specimens',
    description: "The client's price list, and its own short names and specimens for tests.",
    counts: {
      'Test prices': 'SELECT count(*) FROM client_test_price WHERE "clientId" = :c',
      'Location prices': 'SELECT count(*) FROM client_location_test_price p JOIN client_location l ON l.id = p."locationId" WHERE l."clientId" = :c',
      'Short names': 'SELECT count(*) FROM client_test_short_name WHERE "clientId" = :c',
      Specimens: 'SELECT count(*) FROM client_test_specimen WHERE "clientId" = :c',
    },
    exports: {
      client_test_price: 'SELECT * FROM client_test_price WHERE "clientId" = :c',
      client_location_test_price: 'SELECT p.* FROM client_location_test_price p JOIN client_location l ON l.id = p."locationId" WHERE l."clientId" = :c',
      client_test_short_name: 'SELECT * FROM client_test_short_name WHERE "clientId" = :c',
      client_test_specimen: 'SELECT * FROM client_test_specimen WHERE "clientId" = :c',
    },
    deletes: [
      'DELETE FROM client_test_price WHERE "clientId" = :c',
      'DELETE FROM client_location_test_price p USING client_location l WHERE l.id = p."locationId" AND l."clientId" = :c',
      'DELETE FROM client_test_short_name WHERE "clientId" = :c',
      'DELETE FROM client_test_specimen WHERE "clientId" = :c',
    ],
  },
  {
    key: 'packages',
    label: 'Packages',
    description: 'Test packages and the tests in them.',
    counts: { Packages: 'SELECT count(*) FROM package WHERE "clientId" = :c' },
    exports: {
      package: 'SELECT * FROM package WHERE "clientId" = :c',
      package_test: 'SELECT pt.* FROM package_test pt JOIN package p ON p.id = pt."packageId" WHERE p."clientId" = :c',
    },
    deletes: ['DELETE FROM package WHERE "clientId" = :c'], // + package_test
  },
  {
    key: 'payors',
    label: 'Payors (Credit Clients)',
    description: 'Corporate / TPA / insurer payors and their negotiated test prices.',
    needsBills: true,
    counts: {
      Payors: 'SELECT count(*) FROM payor WHERE "clientId" = :c',
      'Payor prices': 'SELECT count(*) FROM payor_test_price x JOIN payor p ON p.id = x."payorId" WHERE p."clientId" = :c',
    },
    exports: {
      payor: 'SELECT * FROM payor WHERE "clientId" = :c',
      payor_test_price: 'SELECT x.* FROM payor_test_price x JOIN payor p ON p.id = x."payorId" WHERE p."clientId" = :c',
    },
    deletes: ['DELETE FROM payor WHERE "clientId" = :c'], // + payor prices (and invoices, already gone with bills)
  },
  {
    key: 'doctors',
    label: 'Referral Doctors',
    description: 'Saved referring doctor names.',
    needsBills: true,
    counts: { Doctors: 'SELECT count(*) FROM referral_doctor WHERE "clientId" = :c' },
    exports: { referral_doctor: 'SELECT * FROM referral_doctor WHERE "clientId" = :c' },
    deletes: ['DELETE FROM referral_doctor WHERE "clientId" = :c'],
  },
  {
    key: 'ranges',
    label: 'Own Normal Ranges & Parameters',
    description: "The client's own copies of Chief Admin normal ranges, its trend settings, and parameters it created itself.",
    needsBills: true,
    counts: {
      'Customised parameters': 'SELECT count(*) FROM client_parameter_override WHERE "clientId" = :c',
      'Own range rows': 'SELECT count(*) FROM parameter_normal_range WHERE "clientId" = :c',
      'Own parameters': 'SELECT count(*) FROM parameter_master WHERE "clientId" = :c',
      'Trend settings': 'SELECT count(*) FROM client_parameter_trend WHERE "clientId" = :c',
    },
    exports: {
      client_parameter_override: 'SELECT * FROM client_parameter_override WHERE "clientId" = :c',
      parameter_normal_range: 'SELECT * FROM parameter_normal_range WHERE "clientId" = :c OR "parameterId" IN (SELECT id FROM parameter_master WHERE "clientId" = :c)',
      parameter_master: 'SELECT * FROM parameter_master WHERE "clientId" = :c',
      client_parameter_trend: 'SELECT * FROM client_parameter_trend WHERE "clientId" = :c',
    },
    deletes: [
      'DELETE FROM client_parameter_override WHERE "clientId" = :c',
      'DELETE FROM client_parameter_trend WHERE "clientId" = :c',
      'DELETE FROM parameter_normal_range WHERE "clientId" = :c',
      'DELETE FROM parameter_master WHERE "clientId" = :c', // + their own range rows and test links
    ],
  },
];
const AREA_BY_KEY = new Map(AREAS.map((a) => [a.key, a]));

async function findClient(req, res) {
  const client = await Client.findByPk(req.params.clientId, { attributes: ['id', 'clientCode', 'clientName'] });
  if (!client) res.status(404).json({ message: 'Client not found' });
  return client;
}

async function countArea(area, clientId, transaction) {
  const counts = {};
  for (const [label, sql] of Object.entries(area.counts)) {
    const [[row]] = await sequelize.query(sql, { replacements: { c: clientId }, transaction });
    counts[label] = Number(row.count);
  }
  return counts;
}

/** Selected area keys, checked: known areas only, and Bills included whenever an area needs it. */
function parseAreas(raw) {
  const keys = [...new Set((Array.isArray(raw) ? raw : String(raw || '').split(',')).map((k) => String(k).trim()).filter(Boolean))];
  const unknown = keys.filter((k) => !AREA_BY_KEY.has(k));
  if (unknown.length) return { error: `Unknown data area(s): ${unknown.join(', ')}` };
  if (keys.length === 0) return { error: 'Select at least one data area' };
  return { keys };
}

async function billsRemain(clientId, keys) {
  if (keys.includes('bills')) return false;
  const [[row]] = await sequelize.query('SELECT count(*) FROM bill WHERE "clientId" = :c', { replacements: { c: clientId } });
  return Number(row.count) > 0;
}

// GET /api/clients/:clientId/data-summary - every area with its counts.
async function getDataSummary(req, res) {
  const client = await findClient(req, res);
  if (!client) return undefined;
  const areas = [];
  for (const a of AREAS) {
    const counts = await countArea(a, client.id);
    areas.push({
      key: a.key, label: a.label, description: a.description, needsBills: !!a.needsBills,
      counts, total: Object.values(counts).reduce((s, n) => s + n, 0),
    });
  }
  return res.json({ client, areas });
}

// GET /api/clients/:clientId/data-export?areas=bills,patients - a JSON
// backup of exactly what a reset of those areas would delete.
async function exportClientData(req, res) {
  const client = await findClient(req, res);
  if (!client) return undefined;
  const { keys, error } = parseAreas(req.query.areas);
  if (error) return res.status(400).json({ message: error });

  const tables = {};
  for (const key of keys) {
    for (const [table, sql] of Object.entries(AREA_BY_KEY.get(key).exports)) {
      const [rows] = await sequelize.query(sql, { replacements: { c: client.id } });
      tables[table] = rows;
    }
  }
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  res.setHeader('Content-Disposition', `attachment; filename="${client.clientCode}-data-backup-${stamp}.json"`);
  return res.json({ client: client.toJSON(), areas: keys, exportedAt: new Date().toISOString(), tables });
}

// POST /api/clients/:clientId/data-reset  Body: { areas: [...], confirmCode }
// Deletes the selected areas of this one client's data, all in one
// transaction (all or nothing). confirmCode must be the client's code.
async function resetClientData(req, res) {
  const client = await findClient(req, res);
  if (!client) return undefined;
  const { keys, error } = parseAreas(req.body.areas);
  if (error) return res.status(400).json({ message: error });
  if (String(req.body.confirmCode || '').trim().toUpperCase() !== client.clientCode.toUpperCase()) {
    return res.status(400).json({ message: `Type the client code ${client.clientCode} to confirm` });
  }
  const blocked = keys.filter((k) => AREA_BY_KEY.get(k).needsBills);
  if (blocked.length && await billsRemain(client.id, keys)) {
    const names = blocked.map((k) => AREA_BY_KEY.get(k).label).join(', ');
    return res.status(400).json({ message: `${names} can only be removed together with Bills & Lab Work while this client has bills.` });
  }

  const deleted = {};
  await sequelize.transaction(async (transaction) => {
    // Bills first: other areas (patients, payors, doctors, parameters) are referenced by them.
    for (const area of AREAS.filter((a) => keys.includes(a.key))) {
      deleted[area.label] = await countArea(area, client.id, transaction);
      for (const sql of area.deletes) {
        await sequelize.query(sql, { replacements: { c: client.id }, transaction });
      }
    }
  });
  console.log(`Client data reset by ${req.user?.username || 'chief admin'}: ${client.clientCode} - ${keys.join(', ')}`);
  return res.json({ message: `Removed from ${client.clientCode}: ${areaLabels(keys)}`, deleted });
}

function areaLabels(keys) {
  return AREAS.filter((a) => keys.includes(a.key)).map((a) => a.label).join(', ');
}

module.exports = { getDataSummary, exportClientData, resetClientData };

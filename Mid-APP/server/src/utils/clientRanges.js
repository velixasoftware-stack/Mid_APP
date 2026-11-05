// Per-clinic normal ranges for universal (Chief Admin) parameters.
//
// A universal parameter's ranges are shared by every clinic. When a clinic
// edits them (adds/removes a range, or changes the printed Normal Range text)
// it gets its own copy instead: a ClientParameterOverride row (holding its
// printed text) plus copies of the range rows carrying its clientId. From
// then on that clinic sees only its copy - its edits never touch other
// clinics, and Chief Admin's later changes don't overwrite it. A clinic that
// never customised keeps following Chief Admin's ranges automatically.
// "Reset" (resetClientRanges) drops the copy and goes back to Chief Admin's.
const { Op } = require('sequelize');
const { ParameterNormalRange, ClientParameterOverride } = require('../models');

const TEXT_KEYS = ['normalRangeText', 'normalRangeTextMale', 'normalRangeTextFemale'];
const plain = (r) => (r.toJSON ? r.toJSON() : r);

/**
 * Sets each parameter's ParameterNormalRanges (and printed range text) to
 * what this clinic uses. clientId null = Chief Admin: the shared rows only.
 * Works on Sequelize instances or plain JSON; marks customizedForClient.
 */
async function applyClientRanges(params, clientId, options = {}) {
  const list = params.filter(Boolean);
  const ids = [...new Set(list.map((p) => p.id))];
  if (ids.length === 0) return;
  const ranges = await ParameterNormalRange.findAll({
    where: { parameterId: ids, [Op.or]: [{ clientId: null }, ...(clientId ? [{ clientId }] : [])] },
    order: [['id', 'ASC']],
    transaction: options.transaction,
  });
  const overrides = clientId
    ? await ClientParameterOverride.findAll({ where: { clientId, parameterId: ids }, transaction: options.transaction })
    : [];
  const overrideByParam = new Map(overrides.map((o) => [o.parameterId, o]));

  for (const p of list) {
    const rows = ranges.filter((r) => r.parameterId === p.id);
    // Only a universal parameter can be customised; a clinic's own parameter
    // simply has its own (clientId null) rows.
    const override = p.clientId == null ? overrideByParam.get(p.id) : null;
    if (override) {
      p.ParameterNormalRanges = rows.filter((r) => r.clientId === clientId).map(plain);
      for (const k of TEXT_KEYS) p[k] = override[k];
    } else {
      p.ParameterNormalRanges = rows.filter((r) => r.clientId == null).map(plain);
    }
    p.customizedForClient = !!override;
  }
}

/**
 * Gives a clinic its own copy of a universal parameter's ranges and text (if
 * it hasn't one yet). Returns { override, copyOf } where copyOf maps each
 * shared range id -> the id of the clinic's copy made now (empty if the
 * clinic was already customised).
 */
async function ensureClientOverride(clientId, parameter, transaction) {
  let override = await ClientParameterOverride.findOne({ where: { clientId, parameterId: parameter.id }, transaction });
  const copyOf = new Map();
  if (override) return { override, copyOf };
  override = await ClientParameterOverride.create({
    clientId, parameterId: parameter.id,
    normalRangeText: parameter.normalRangeText || null,
    normalRangeTextMale: parameter.normalRangeTextMale || null,
    normalRangeTextFemale: parameter.normalRangeTextFemale || null,
  }, { transaction });
  const shared = await ParameterNormalRange.findAll({ where: { parameterId: parameter.id, clientId: null }, order: [['id', 'ASC']], transaction });
  for (const r of shared) {
    const copy = await ParameterNormalRange.create({
      parameterId: parameter.id, clientId,
      gender: r.gender, ageMin: r.ageMin, ageMax: r.ageMax, ageUnit: r.ageUnit, ageMaxUnit: r.ageMaxUnit,
      normalRangeLow: r.normalRangeLow, normalRangeHigh: r.normalRangeHigh, rangeText: r.rangeText,
    }, { transaction });
    copyOf.set(r.id, copy.id);
  }
  return { override, copyOf };
}

/** Drops a clinic's copy - it follows Chief Admin's ranges again. */
async function resetClientRanges(clientId, parameterId, transaction) {
  await ParameterNormalRange.destroy({ where: { parameterId, clientId }, transaction });
  await ClientParameterOverride.destroy({ where: { parameterId, clientId }, transaction });
}

module.exports = { applyClientRanges, ensureClientOverride, resetClientRanges, TEXT_KEYS };

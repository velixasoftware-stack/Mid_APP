/**
 * Resolves the normal range that applies to one patient for one parameter.
 * Prefers a gender-exact ParameterNormalRange rule whose age band (if any)
 * contains the patient's age, then any gender-agnostic ("Any") rule whose
 * age band matches, and falls back to the parameter's own flat
 * normalRangeLow/High when nothing more specific matches (or age/gender is
 * unknown).
 */
const GENDER_ALIASES = { m: 'male', f: 'female', o: 'other' };

// A patient's age and a rule's age band can each be given in a different unit
// (e.g. a newborn's age in days against a "0-7 days" rule, while an adult's
// age in years matches an "18-60 years" rule) - both sides are converted to
// days, an approximation good enough for age-band matching, before comparing.
const DAYS_PER_UNIT = { Days: 1, Months: 30, Years: 365 };

function toDays(value, unit) {
  if (value == null || value === '') return null;
  return Number(value) * (DAYS_PER_UNIT[unit] || DAYS_PER_UNIT.Years);
}

function normalizeGender(gender) {
  const g = (gender || '').trim().toLowerCase();
  return GENDER_ALIASES[g] || g;
}

function resolveNormalRange(parameter, age, gender, ageUnit) {
  const rules = parameter.ParameterNormalRanges || [];
  const normalizedGender = normalizeGender(gender);
  const ageInDays = toDays(age, ageUnit || 'Years');

  const ageMatches = (rule) => {
    const minDays = toDays(rule.ageMin, rule.ageUnit || 'Years');
    const maxDays = toDays(rule.ageMax, rule.ageMaxUnit || rule.ageUnit || 'Years'); // "To" may have its own unit
    if (minDays != null && (ageInDays == null || ageInDays < minDays)) return false;
    if (maxDays != null && (ageInDays == null || ageInDays > maxDays)) return false;
    return true;
  };

  const candidates = rules.filter(ageMatches);
  const genderMatch = normalizedGender
    ? candidates.find((r) => normalizeGender(r.gender) === normalizedGender)
    : null;
  // A row for everyone - "All" (older rows: "Any").
  const anyMatch = candidates.find((r) => ['all', 'any'].includes(normalizeGender(r.gender || 'all')));
  const chosen = genderMatch || anyMatch;

  if (chosen) {
    return { normalRangeLow: chosen.normalRangeLow, normalRangeHigh: chosen.normalRangeHigh, matchedRuleId: chosen.id, rangeText: chosen.rangeText || null };
  }
  return { normalRangeLow: parameter.normalRangeLow, normalRangeHigh: parameter.normalRangeHigh, matchedRuleId: null };
}

// The Normal Range text printed for this patient. When one of the
// parameter's age/gender range rows matched (`resolved`, from
// resolveNormalRange), it's that row's own printed text - or null, so the
// report prints that row's low - high. Only when no row matched: the
// parameter's male/female text for a male/female patient when set,
// otherwise its common normalRangeText. Null = the report prints low - high.
function printedRangeText(parameter, gender, resolved) {
  const pick = (v) => (v && v.toString().trim() ? v : null);
  if (resolved?.matchedRuleId) return pick(resolved.rangeText);
  const g = (gender || '').toString().trim().toLowerCase();
  if (g === 'male' && pick(parameter.normalRangeTextMale)) return parameter.normalRangeTextMale;
  if (g === 'female' && pick(parameter.normalRangeTextFemale)) return parameter.normalRangeTextFemale;
  return pick(parameter.normalRangeText);
}

module.exports = { resolveNormalRange, printedRangeText };

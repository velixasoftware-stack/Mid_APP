// A test's collection timing (TestMaster.testType). A Fasting sample and a
// Post Lunch sample are drawn hours apart, so one collection action (lab
// Collect, or barcodes scanned at billing) may include either, never both.
const TEST_TYPES = ['REGULAR', 'FASTING', 'POST_LUNCH'];

function normalizeTestType(value) {
  if (value === undefined || value === null || value === '') return undefined;
  const v = String(value).trim().toUpperCase().replace(/[\s-]+/g, '_');
  if (v === 'PP' || v === 'POSTLUNCH') return 'POST_LUNCH';
  return TEST_TYPES.includes(v) ? v : null; // null = invalid
}

// Given the TestMaster rows being collected together, returns an error
// message when they mix Fasting and Post Lunch, otherwise null.
function fastingPostLunchConflict(tests) {
  const fasting = tests.filter((t) => t?.testType === 'FASTING');
  const postLunch = tests.filter((t) => t?.testType === 'POST_LUNCH');
  if (fasting.length === 0 || postLunch.length === 0) return null;
  return `Fasting (${fasting.map((t) => t.testName).join(', ')}) and Post Lunch (${postLunch.map((t) => t.testName).join(', ')}) `
    + 'samples can\'t be collected at the same time - collect one first, then the other separately.';
}

module.exports = { TEST_TYPES, normalizeTestType, fastingPostLunchConflict };

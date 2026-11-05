// A test's collection timing (TestMaster.testType) - mirrors server/src/utils/testType.js.
// Fasting and Post Lunch samples are drawn at different times, so one
// collection may include either (plus Regular tests) but never both.
export const TEST_TYPE_OPTIONS = [
  { value: 'REGULAR', label: 'Regular' },
  { value: 'FASTING', label: 'Fasting' },
  { value: 'POST_LUNCH', label: 'Post Lunch' },
];

export const TEST_TYPE_LABEL = Object.fromEntries(TEST_TYPE_OPTIONS.map((o) => [o.value, o.label]));

export function conflictsWith(typeA, typeB) {
  return (typeA === 'FASTING' && typeB === 'POST_LUNCH') || (typeA === 'POST_LUNCH' && typeB === 'FASTING');
}

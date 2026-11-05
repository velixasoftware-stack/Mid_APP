/** Consistent 2-decimal money formatting - avoids mixing "550.00" (from a
 * Sequelize DECIMAL field, which serializes as a string) with "550" (from a
 * plain JS number computed on the client) in the same table. */
export function formatMoney(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n.toFixed(2) : '0.00';
}

const SHORT_MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

/** Formats a date as "13-SEP-2026". */
export function formatDateDMY(value) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return `${String(d.getDate()).padStart(2, '0')}-${SHORT_MONTHS[d.getMonth()]}-${d.getFullYear()}`;
}

/** A referring doctor's name with a single "Dr." in front - names may be
 * saved with or without it ("Ramesh Kumar" / "Dr. Ramesh Kumar"). */
export function doctorLabel(name) {
  const n = (name || '').trim();
  if (!n) return '';
  return /^dr\b\.?/i.test(n) ? n : `Dr. ${n}`;
}

/** A patient's name with their title in front ("Mr. Ravi Kumar"), or just the
 * name for patients saved without one. */
export function patientLabel(patient) {
  if (!patient) return '';
  return [patient.title, patient.name].filter(Boolean).join(' ');
}

import { useEffect, useState } from 'react';
import api from '../api/client';

// Chief Admin maintains one title list for every client - fetched once per
// page load and shared by every dropdown on it.
let titlesRequest = null;
function loadTitles() {
  if (!titlesRequest) {
    titlesRequest = api.get('/patients/titles').then((r) => r.data).catch(() => {
      titlesRequest = null; // let the next dropdown retry
      return [];
    });
  }
  return titlesRequest;
}

/**
 * Patient Title dropdown (Mr./Mrs./...) from Chief Admin's Patient Titles.
 * onChange(title, gender) - gender is the one Chief Admin mapped to that
 * title (e.g. Mrs. -> Female), or null when the title has none (e.g. Dr.),
 * so the caller can select it automatically. A saved title no longer in the
 * list (since deleted) is still shown, so editing such a patient doesn't
 * silently drop it.
 */
export default function PatientTitleSelect({ value, onChange, disabled, style }) {
  const [titles, setTitles] = useState([]);
  useEffect(() => {
    let alive = true;
    loadTitles().then((list) => { if (alive) setTitles(list); });
    return () => { alive = false; };
  }, []);

  const names = titles.map((t) => t.name);
  const options = value && !names.includes(value) ? [value, ...names] : names;
  function handleChange(e) {
    const name = e.target.value;
    onChange(name, titles.find((t) => t.name === name)?.gender || null);
  }
  return (
    <select value={value || ''} onChange={handleChange} disabled={disabled} style={style}>
      <option value="">—</option>
      {options.map((t) => <option key={t} value={t}>{t}</option>)}
    </select>
  );
}

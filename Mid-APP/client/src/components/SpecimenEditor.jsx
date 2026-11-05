import { useEffect, useState } from 'react';
import api from '../api/client';
import { Icon } from './Icons';

// Suggestions only - any specimen can be typed.
const COMMON_SPECIMENS = [
  'Serum', 'Plasma', 'Whole Blood (EDTA)', 'Fluoride Plasma', 'Citrated Plasma', 'Heparin Plasma',
  'Urine', 'Urine (24 Hours)', 'Stool', 'CSF', 'Sputum', 'Swab', 'Semen', 'Body Fluid', 'Tissue',
];

/**
 * A client's own specimen (sample type) for a test - printed on its reports
 * in place of Chief Admin's Test Master value, which is never changed and
 * stays the same for every other client. Empty / Reset = Chief Admin's again.
 */
export default function SpecimenEditor({ test, onSaved }) {
  const masterValue = test.sampleType || '';
  const own = test.clientSampleType || '';
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(own || masterValue);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { setEditing(false); setValue(own || masterValue); setError(''); }, [test.id, own, masterValue]);

  async function save(next) {
    setBusy(true);
    setError('');
    try {
      // Same as Chief Admin's = no override needed.
      const sampleType = next.trim() === masterValue.trim() ? '' : next.trim();
      await api.put(`/test-config/tests/${test.id}/specimen`, { sampleType });
      setEditing(false);
      await onSaved?.();
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to save specimen');
    } finally {
      setBusy(false);
    }
  }

  if (!editing) {
    return (
      <div className="specimen-line">
        <span>Specimen:</span>
        <strong>{own || masterValue || 'Not set'}</strong>
        {own ? <span className="specimen-tag own">Your lab</span> : <span className="specimen-tag">Chief Admin</span>}
        {own && masterValue && <span className="cell-sub">(Chief Admin: {masterValue})</span>}
        <button type="button" className="icon-btn" title="Change the specimen printed on your reports" onClick={() => setEditing(true)}><Icon name="edit" size={13} /></button>
        {error && <span className="error-text">{error}</span>}
      </div>
    );
  }
  return (
    <div className="specimen-line">
      <span>Specimen:</span>
      <input list="specimen-options" value={value} onChange={(e) => setValue(e.target.value)} maxLength={100} placeholder="e.g. Serum" autoFocus />
      <datalist id="specimen-options">{COMMON_SPECIMENS.map((s) => <option key={s} value={s} />)}</datalist>
      <button type="button" onClick={() => save(value)} disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
      {own && <button type="button" className="secondary" onClick={() => save('')} disabled={busy} title="Use Chief Admin's specimen again">Reset</button>}
      <button type="button" className="secondary" onClick={() => setEditing(false)} disabled={busy}>Cancel</button>
      <span className="cell-sub">Only your lab&apos;s reports - Chief Admin&apos;s Test Master is not changed.</span>
      {error && <span className="error-text">{error}</span>}
    </div>
  );
}

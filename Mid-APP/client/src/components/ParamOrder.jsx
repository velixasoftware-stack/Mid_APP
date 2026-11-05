import { useEffect, useState } from 'react';
import api from '../api/client';

/**
 * "Seq" cell for a test's parameter table: type the parameter's sequence
 * number (1, 2, 3 ...) - saved on Enter or when leaving the box. Result entry
 * and the printed report list parameters in this order.
 */
export default function ParamOrder({ apiBase, testId, param, onSaved }) {
  const current = param.sequence ?? '';
  const [value, setValue] = useState(String(current));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => { setValue(String(param.sequence ?? '')); }, [param.sequence]);

  async function save() {
    const next = value.trim();
    if (next === String(current) || saving) return;
    setSaving(true);
    setError('');
    try {
      await api.put(`${apiBase}/tests/${testId}/parameters/${param.id}/sequence`, { sequence: next === '' ? null : Number(next) });
      await onSaved?.();
    } catch (err) {
      setError(err.response?.data?.message || 'Could not save');
      setValue(String(current));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="param-seq">
      <input
        type="number"
        min="1"
        max="999"
        inputMode="numeric"
        value={value}
        placeholder="–"
        disabled={saving}
        title={error || 'Sequence no. - order on result entry and the report (Enter to save)'}
        className={error ? 'error' : ''}
        onChange={(e) => setValue(e.target.value)}
        onBlur={save}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); } }}
      />
    </div>
  );
}

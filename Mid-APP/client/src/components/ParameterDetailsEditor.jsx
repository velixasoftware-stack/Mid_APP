import { useEffect, useState } from 'react';
import api from '../api/client';

/**
 * Name / unit / method of one parameter, editable after it was created.
 * apiBase: '/admin/masters' (Chief Admin) or '/test-config' (client).
 * - Chief Admin: changes the universal parameter for every client.
 * - Client, own parameter: changes it directly.
 * - Client, universal parameter: saved for this lab only (other labs and
 *   Chief Admin's master keep theirs); "Use Chief Admin's" undoes it.
 * onSaved: reload the screen's data (and the open parameter).
 */
export default function ParameterDetailsEditor({ apiBase, param, isClient, onSaved }) {
  const [form, setForm] = useState({ parameterName: '', unit: '', method: '' });
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    setForm({ parameterName: param.parameterName || '', unit: param.unit || '', method: param.method || '' });
  }, [param.id, param.parameterName, param.unit, param.method]);

  const universal = param.clientId == null;
  const labOnly = isClient && universal;
  const master = param.masterLabel;
  const changed = form.parameterName.trim() !== (param.parameterName || '')
    || form.unit.trim() !== (param.unit || '')
    || form.method.trim() !== (param.method || '');

  async function save(body) {
    setSaving(true);
    setError('');
    setMessage('');
    try {
      const { data } = await api.put(`${apiBase}/parameters/${param.id}`, body);
      setMessage(data.message || 'Saved');
      await onSaved();
    } catch (err) {
      setError(err.response?.data?.message || 'Could not save the parameter');
    } finally {
      setSaving(false);
    }
  }

  function handleSave(e) {
    e.preventDefault();
    if (!form.parameterName.trim()) { setError('Parameter name is required'); return; }
    if (!isClient && universal && !window.confirm(`Change "${param.parameterName}" for ALL clients?\n\nLabs that set their own name/unit for it keep theirs.`)) return;
    save({ parameterName: form.parameterName, unit: form.unit, method: form.method });
  }

  return (
    <form onSubmit={handleSave} style={{ border: '1px solid #e2e8f0', borderRadius: 8, padding: 12, margin: '8px 0 14px' }}>
      <h4 style={{ margin: '0 0 4px' }}>Parameter Details</h4>
      <p style={{ fontSize: 12, color: '#64748b', margin: '0 0 8px' }}>
        {labOnly && 'Universal parameter - your changes apply to YOUR LAB ONLY (result entry and reports). Other labs keep Chief Admin\'s.'}
        {!isClient && universal && 'Universal parameter - changes apply to all clients.'}
        {isClient && !universal && 'Your own parameter.'}
      </p>
      <div className="form-grid" style={{ alignItems: 'end' }}>
        <label><span>Parameter Name</span>
          <input value={form.parameterName} onChange={(e) => setForm((f) => ({ ...f, parameterName: e.target.value }))} required />
        </label>
        <label><span>Unit</span>
          <input value={form.unit} onChange={(e) => setForm((f) => ({ ...f, unit: e.target.value }))} placeholder="e.g. g/dL" />
        </label>
        <label><span>Method</span>
          <input value={form.method} onChange={(e) => setForm((f) => ({ ...f, method: e.target.value }))} placeholder="e.g. Photometry" />
        </label>
        <div style={{ display: 'flex', gap: 6 }}>
          <button type="submit" disabled={saving || !changed}>{saving ? 'Saving…' : 'Save Details'}</button>
          {labOnly && param.labelCustomizedForClient && (
            <button type="button" className="secondary" disabled={saving} onClick={() => save({ reset: true })}>
              Use Chief Admin&apos;s
            </button>
          )}
        </div>
      </div>
      {labOnly && param.labelCustomizedForClient && master && (
        <p style={{ fontSize: 12, color: '#b45309', margin: '6px 0 0' }}>
          Chief Admin&apos;s: {master.parameterName} · {master.unit || 'no unit'} · {master.method || 'no method'}
        </p>
      )}
      {message && <p style={{ color: '#166534', fontSize: 13, margin: '6px 0 0' }}>{message}</p>}
      {error && <p className="error-text" style={{ margin: '6px 0 0' }}>{error}</p>}
    </form>
  );
}

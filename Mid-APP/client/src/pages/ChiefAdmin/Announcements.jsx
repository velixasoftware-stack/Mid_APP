import { useEffect, useState } from 'react';
import api from '../../api/client';

const TONES = [
  { key: 'info', label: 'Info (blue)' },
  { key: 'warning', label: 'Warning (amber)' },
  { key: 'success', label: 'Success (green)' },
];

function blankForm() {
  return { message: '', tone: 'info', active: true, fromDate: '', toDate: '' };
}

// Where a caption stands today: shown to clients, waiting for its From date,
// past its To date, or switched off.
function liveState(a, today) {
  if (!a.active) return { key: 'inactive', label: 'Inactive' };
  if (a.fromDate && a.fromDate > today) return { key: 'scheduled', label: 'Scheduled' };
  if (a.toDate && a.toDate < today) return { key: 'expired', label: 'Expired' };
  return { key: 'live', label: 'Live now' };
}

function formatDate(d) {
  return d ? new Date(`${d}T00:00:00`).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
}

/**
 * Chief Admin: captions shown to every client on the client login page and as
 * a banner inside the app - while Active and today is within From..To.
 */
export default function Announcements() {
  const [rows, setRows] = useState([]);
  const [today, setToday] = useState('');
  const [form, setForm] = useState(blankForm());
  const [editingId, setEditingId] = useState(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [saving, setSaving] = useState(false);

  async function load() {
    const { data } = await api.get('/announcements');
    setRows(data.announcements);
    setToday(data.today);
  }
  useEffect(() => { load(); }, []);

  function set(key, value) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function startEdit(a) {
    setEditingId(a.id);
    setForm({ message: a.message, tone: a.tone || 'info', active: a.active, fromDate: a.fromDate || '', toDate: a.toDate || '' });
    setError('');
    setMessage('');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function cancelEdit() {
    setEditingId(null);
    setForm(blankForm());
    setError('');
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (saving) return;
    setError('');
    setMessage('');
    setSaving(true);
    try {
      const body = { ...form, fromDate: form.fromDate || null, toDate: form.toDate || null };
      if (editingId) await api.put(`/announcements/${editingId}`, body);
      else await api.post('/announcements', body);
      setMessage(editingId ? 'Caption updated.' : 'Caption added - clients will see it while it is active and within its dates.');
      setEditingId(null);
      setForm(blankForm());
      await load();
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to save caption');
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive(a) {
    setError('');
    try {
      await api.put(`/announcements/${a.id}`, { active: !a.active });
      await load();
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to update caption');
    }
  }

  async function handleDelete(a) {
    if (!window.confirm(`Delete this caption?\n\n"${a.message}"`)) return;
    setError('');
    try {
      await api.delete(`/announcements/${a.id}`);
      if (editingId === a.id) cancelEdit();
      await load();
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to delete caption');
    }
  }

  const liveCount = rows.filter((a) => liveState(a, today).key === 'live').length;

  return (
    <div>
      <div className="card">
        <div className="caption-head">
          <div>
            <h3 style={{ margin: 0 }}>Login Captions</h3>
            <p className="cell-sub" style={{ margin: '2px 0 0' }}>
              Shown to <strong>all clients</strong> on the client login page and as a banner inside their app -
              only while <strong>Active</strong> and today is between the From and To dates.
            </p>
          </div>
          <span className="caption-live-count">{liveCount} live now</span>
        </div>

        <form onSubmit={handleSubmit} className="caption-form">
          <label className="caption-message">
            <span>Caption text</span>
            <textarea
              rows={2}
              maxLength={500}
              value={form.message}
              onChange={(e) => set('message', e.target.value)}
              placeholder="e.g. Scheduled maintenance on Sunday 6:00-8:00 AM - billing will be unavailable."
              required
            />
            <small className="cell-sub">{form.message.length}/500</small>
          </label>
          <div className="caption-fields">
            <label><span>Style</span>
              <select value={form.tone} onChange={(e) => set('tone', e.target.value)}>
                {TONES.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
              </select>
            </label>
            <label><span>From date</span>
              <input type="date" value={form.fromDate} max={form.toDate || undefined} onChange={(e) => set('fromDate', e.target.value)} />
            </label>
            <label><span>To date</span>
              <input type="date" value={form.toDate} min={form.fromDate || undefined} onChange={(e) => set('toDate', e.target.value)} />
            </label>
            <label className="caption-active"><span>Status</span>
              <button type="button" className={`switch ${form.active ? 'on' : ''}`} onClick={() => set('active', !form.active)} aria-pressed={form.active}>
                <i />{form.active ? 'Active' : 'Inactive'}
              </button>
            </label>
            <div className="caption-actions">
              <button type="submit" disabled={saving}>{saving ? 'Saving…' : editingId ? 'Update Caption' : 'Add Caption'}</button>
              {editingId && <button type="button" className="secondary" onClick={cancelEdit}>Cancel</button>}
            </div>
          </div>
          <p className="cell-sub" style={{ margin: '2px 0 0' }}>Leave From / To empty to show it starting now / until switched off.</p>
        </form>

        {form.message.trim() && (
          <div className="caption-preview">
            <span className="cell-sub">Preview (as clients see it)</span>
            <div className={`announcement ${form.tone}`}>
              <span className="announcement-text">{form.message}</span>
            </div>
          </div>
        )}

        {error && <p className="error-text">{error}</p>}
        {message && <p className="success-text">{message}</p>}
      </div>

      <div className="card orders-card">
        <table className="orders-table">
          <thead>
            <tr><th>Caption</th><th>From</th><th>To</th><th>Status</th><th>Active</th><th>Actions</th></tr>
          </thead>
          <tbody>
            {rows.map((a) => {
              const state = liveState(a, today);
              return (
                <tr key={a.id} className={editingId === a.id ? 'row-editing' : ''}>
                  <td style={{ whiteSpace: 'normal', maxWidth: 420 }}>
                    <span className={`tone-dot ${a.tone}`} />{a.message}
                  </td>
                  <td style={{ whiteSpace: 'nowrap' }}>{formatDate(a.fromDate)}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>{formatDate(a.toDate)}</td>
                  <td><span className={`caption-state ${state.key}`}>{state.label}</span></td>
                  <td>
                    <button type="button" className={`switch small ${a.active ? 'on' : ''}`} onClick={() => toggleActive(a)} aria-pressed={a.active} title={a.active ? 'Click to deactivate' : 'Click to activate'}>
                      <i />{a.active ? 'On' : 'Off'}
                    </button>
                  </td>
                  <td>
                    <div className="order-actions">
                      <button type="button" className="secondary" onClick={() => startEdit(a)}>Edit</button>
                      <button type="button" className="danger" onClick={() => handleDelete(a)}>Delete</button>
                    </div>
                  </td>
                </tr>
              );
            })}
            {rows.length === 0 && <tr><td colSpan={6} className="empty-row">No captions yet - add one above.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

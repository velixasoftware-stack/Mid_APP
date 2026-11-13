import { useEffect, useState } from 'react';
import api from '../../api/client';
import { downloadFile } from '../../utils/download';
import SearchSelect from '../../components/SearchSelect';

/**
 * Chief Admin: remove one client's data, area by area (bills & lab work,
 * patients, prices, packages, payors, doctors, own ranges) - e.g. clearing
 * test/demo data before the client goes live. Only the chosen client is
 * touched. A backup of exactly what would be removed can be downloaded
 * first, and the client code must be typed to confirm.
 */
export default function ClientDataReset() {
  const [clients, setClients] = useState([]);
  const [clientId, setClientId] = useState('');
  const [summary, setSummary] = useState(null);
  const [selected, setSelected] = useState(new Set());
  const [confirmCode, setConfirmCode] = useState('');
  const [busy, setBusy] = useState(''); // 'load' | 'backup' | 'reset'
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);
  // Optional From/To date range (inclusive). appliedRange = the range the
  // counts on screen were loaded for, and the one a backup/reset uses.
  const [range, setRange] = useState({ fromDate: '', toDate: '' });
  const [appliedRange, setAppliedRange] = useState(null);

  useEffect(() => {
    api.get('/clients').then((r) => setClients(r.data.clients || [])).catch(() => setError('Failed to load clients'));
  }, []);

  async function loadSummary(id, withRange = appliedRange) {
    setBusy('load');
    setError('');
    try {
      const { data } = await api.get(`/clients/${id}/data-summary`, { params: withRange || {} });
      setSummary(data);
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to load this client\'s data');
      setSummary(null);
    } finally {
      setBusy('');
    }
  }

  function chooseClient(id) {
    setClientId(id);
    setSelected(new Set());
    setConfirmCode('');
    setResult(null);
    setSummary(null);
    if (id) loadSummary(id);
  }

  function applyRange() {
    if (!range.fromDate || !range.toDate) { setError('Select both From Date and To Date'); return; }
    if (range.fromDate > range.toDate) { setError('From Date cannot be after To Date'); return; }
    const next = { ...range };
    setAppliedRange(next);
    setSelected(new Set());
    setConfirmCode('');
    setResult(null);
    loadSummary(clientId, next);
  }
  function clearRange() {
    setRange({ fromDate: '', toDate: '' });
    setAppliedRange(null);
    setSelected(new Set());
    setConfirmCode('');
    setResult(null);
    loadSummary(clientId, null);
  }
  const rangeLabel = appliedRange ? `${appliedRange.fromDate} to ${appliedRange.toDate}` : '';

  const areas = summary?.areas || [];
  const billsArea = areas.find((a) => a.key === 'bills');
  const hasBills = (billsArea?.total || 0) > 0;
  const client = summary?.client;

  // An area that needs Bills can only go together with Bills while bills exist.
  function toggle(area) {
    if (area.rangeNotApplicable) return;
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(area.key)) {
        next.delete(area.key);
        if (area.key === 'bills' && hasBills) areas.filter((a) => a.needsBills).forEach((a) => next.delete(a.key));
      } else {
        next.add(area.key);
        if (area.needsBills && hasBills) next.add('bills');
      }
      return next;
    });
    setResult(null);
  }
  function selectAll(on) {
    setSelected(on ? new Set(areas.filter((a) => a.total > 0 && !a.rangeNotApplicable).map((a) => a.key)) : new Set());
    setResult(null);
  }

  const chosen = areas.filter((a) => selected.has(a.key));
  const chosenTotal = chosen.reduce((s, a) => s + a.total, 0);
  const codeOk = client && confirmCode.trim().toUpperCase() === client.clientCode.toUpperCase();

  async function downloadBackup() {
    setBusy('backup');
    setError('');
    try {
      const stamp = new Date().toISOString().slice(0, 10);
      const rangeQs = appliedRange ? `&fromDate=${appliedRange.fromDate}&toDate=${appliedRange.toDate}` : '';
      await downloadFile(`/clients/${clientId}/data-export?areas=${[...selected].join(',')}${rangeQs}`, `${client.clientCode}-data-backup-${stamp}.json`);
    } catch {
      setError('Failed to download the backup');
    } finally {
      setBusy('');
    }
  }

  async function handleReset() {
    if (!codeOk || chosen.length === 0) return;
    const list = chosen.map((a) => `• ${a.label} (${a.total})`).join('\n');
    const period = appliedRange ? `\nOnly bills dated ${rangeLabel} (both days included).\n` : '';
    if (!window.confirm(`Permanently delete this data for ${client.clientCode} - ${client.clientName}?\n${period}\n${list}\n\nThis cannot be undone.`)) return;
    setBusy('reset');
    setError('');
    try {
      const { data } = await api.post(`/clients/${clientId}/data-reset`, { areas: [...selected], confirmCode, ...(appliedRange || {}) });
      setResult(data);
      setSelected(new Set());
      setConfirmCode('');
      await loadSummary(clientId);
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to remove the data');
    } finally {
      setBusy('');
    }
  }

  return (
    <div>
      <div className="card">
        <h3 style={{ margin: 0 }}>Client Data Reset</h3>
        <p className="cell-sub" style={{ margin: '2px 0 12px' }}>
          Remove one client&apos;s data - for example test bills entered before going live. Only the client you pick
          is affected; its users, logins, subscription and branding are never removed here.
        </p>
        <div style={{ maxWidth: 420 }}>
          <span className="reset-field-label">Client</span>
          <SearchSelect
            options={clients.map((c) => ({ value: c.id, label: `${c.clientCode} — ${c.clientName}`, sublabel: [c.mobile, c.email].filter(Boolean).join(' · ') }))}
            value={clientId}
            onChange={(id) => chooseClient(id ? String(id) : '')}
            placeholder="Search by client code, name, mobile…"
          />
        </div>
        {error && <p className="error-text">{error}</p>}
      </div>

      {clientId && (
        <div className="card">
          {busy === 'load' && !summary && <p className="cell-sub">Loading…</p>}
          {summary && (
            <>
              <div className="reset-head">
                <strong>{client.clientCode} — {client.clientName}{appliedRange && <span className="cell-sub"> · bills dated {rangeLabel}</span>}</strong>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button type="button" className="secondary" onClick={() => selectAll(true)}>Select all with data</button>
                  <button type="button" className="secondary" onClick={() => selectAll(false)}>Clear</button>
                </div>
              </div>
              <div className="form-grid" style={{ alignItems: 'end', margin: '10px 0' }}>
                <label><span>From Date</span>
                  <input type="date" value={range.fromDate} max={range.toDate || undefined} onChange={(e) => setRange((r) => ({ ...r, fromDate: e.target.value }))} />
                </label>
                <label><span>To Date</span>
                  <input type="date" value={range.toDate} min={range.fromDate || undefined} onChange={(e) => setRange((r) => ({ ...r, toDate: e.target.value }))} />
                </label>
                <button type="button" onClick={applyRange} disabled={!!busy || !range.fromDate || !range.toDate}>Apply Date Range</button>
                {appliedRange && <button type="button" className="secondary" onClick={clearRange} disabled={!!busy}>Show all dates</button>}
              </div>
              <p className="cell-sub" style={{ margin: '0 0 10px' }}>
                {appliedRange
                  ? 'Date range on: only Bills & Lab Work created in this range (with their tests, samples, results and reports) will be removed. Other data is not dated, so it is left alone.'
                  : 'Optional: pick a From Date and To Date to remove only the bills & lab work of that period. Without dates, everything selected below is removed.'}
              </p>
              {appliedRange && summary.outsideBillsOnInvoices > 0 && (
                <p className="reset-note">
                  Note: {summary.outsideBillsOnInvoices} bill(s) outside this range are on the same payor invoice(s). Those invoices are removed; those bills stay but show as not invoiced.
                </p>
              )}
              <table className="reset-table">
                <thead><tr><th style={{ width: 36 }} /><th>Data</th><th>What&apos;s there now</th></tr></thead>
                <tbody>
                  {areas.map((a) => (
                    <tr key={a.key} className={selected.has(a.key) ? 'selected' : ''} onClick={() => toggle(a)} style={a.rangeNotApplicable ? { opacity: 0.45, cursor: 'not-allowed' } : undefined}>
                      <td><input type="checkbox" checked={selected.has(a.key)} disabled={a.rangeNotApplicable} onChange={() => toggle(a)} onClick={(e) => e.stopPropagation()} /></td>
                      <td>
                        <div className="reset-area">{a.label}</div>
                        <div className="cell-sub">{a.description}</div>
                        {a.rangeNotApplicable && <div className="reset-note">Not available with a date range</div>}
                        {!a.rangeNotApplicable && a.needsBills && hasBills && <div className="reset-note">Removed together with Bills &amp; Lab Work</div>}
                      </td>
                      <td>
                        <div className="reset-counts">
                          {Object.entries(a.counts).map(([label, n]) => (
                            <span key={label} className={n ? 'has' : ''}>{label}: <strong>{n}</strong></span>
                          ))}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <div className="reset-actions">
                <div>
                  <button type="button" className="secondary" onClick={downloadBackup} disabled={chosen.length === 0 || !!busy}>
                    {busy === 'backup' ? 'Preparing…' : 'Download backup of selected'}
                  </button>
                  <p className="cell-sub" style={{ margin: '4px 0 0' }}>Recommended before deleting - a JSON file of exactly what will be removed.</p>
                </div>
                <div className="reset-confirm">
                  <label><span>Type <strong>{client.clientCode}</strong> to confirm</span>
                    <input value={confirmCode} onChange={(e) => setConfirmCode(e.target.value)} placeholder={client.clientCode} disabled={chosen.length === 0} />
                  </label>
                  <button type="button" className="danger" onClick={handleReset} disabled={!codeOk || chosen.length === 0 || !!busy}>
                    {busy === 'reset' ? 'Deleting…' : `Delete selected (${chosenTotal} records)`}
                  </button>
                </div>
              </div>
            </>
          )}
          {result && (
            <div className="reset-result">
              <strong>{result.message}</strong>
              {Object.entries(result.deleted || {}).map(([area, counts]) => (
                <div key={area} className="cell-sub">
                  {area}: {Object.entries(counts).map(([k, n]) => `${k} ${n}`).join(', ')}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

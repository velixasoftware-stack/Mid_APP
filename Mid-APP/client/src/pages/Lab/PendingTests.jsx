import { useEffect, useMemo, useState } from 'react';
import api from '../../api/client';
import { Icon } from '../../components/Icons';
import { StatusPill, TEST_STAGES } from '../../components/TestStatus';
import { downloadFile } from '../../utils/download';

// The stages a test can sit in between registration and report release.
const PENDING_STAGES = TEST_STAGES.filter((s) => s.key !== 'RELEASED');

function daysAgoISO(days) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}
function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function formatAge(age, ageUnit) {
  if (age == null || age === '') return '';
  if (ageUnit === 'Months') return `${age}mo`;
  if (ageUnit === 'Days') return `${age}d`;
  return `${age}y`;
}

// How long the test has been waiting since the patient was registered/billed.
function waitingFor(iso) {
  if (!iso) return '';
  const mins = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60000));
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ${mins % 60}m`;
  return `${Math.floor(hrs / 24)}d ${hrs % 24}h`;
}

/**
 * Pending Lab Tests - every test from registration up to (not including)
 * report release, with a walk-in date range, status tabs, search and an
 * Excel export of exactly what's on screen.
 */
export default function PendingTests() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [fromDate, setFromDate] = useState(() => daysAgoISO(7));
  const [toDate, setToDate] = useState(() => todayISO());
  const [status, setStatus] = useState('');
  const [search, setSearch] = useState('');
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    api.get('/report-view/pending-tests', { params: { from: fromDate || undefined, to: toDate || undefined } })
      .then(({ data }) => { if (!cancelled) setRows(data); })
      .catch((err) => { if (!cancelled) setError(err.response?.data?.message || 'Failed to load pending tests'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [fromDate, toDate]);

  const q = search.trim().toLowerCase();
  const searched = useMemo(() => rows.filter((r) => !q || [r.patientName, r.barcode, r.billNo, r.umr, r.testName, r.mobile]
    .some((f) => (f || '').toString().toLowerCase().includes(q))), [rows, q]);
  const counts = useMemo(() => Object.fromEntries(
    PENDING_STAGES.map((s) => [s.key, searched.filter((r) => r.status === s.key).length]),
  ), [searched]);
  const visible = status ? searched.filter((r) => r.status === status) : searched;

  async function handleExport() {
    setExporting(true);
    try {
      const params = new URLSearchParams({ format: 'xlsx' });
      if (fromDate) params.set('from', fromDate);
      if (toDate) params.set('to', toDate);
      if (status) params.set('status', status);
      if (search.trim()) params.set('q', search.trim());
      await downloadFile(`/report-view/pending-tests?${params}`, `pending-tests_${fromDate || 'all'}_to_${toDate || 'all'}.xlsx`);
    } catch {
      setError('Export failed - please try again');
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="card orders-card">
      <div className="topbar compact-header">
        <h3 className="section-heading" style={{ margin: 0 }}>
          <span className="icon-badge"><Icon name="clock" size={15} /></span> Pending Lab Tests
        </h3>
        <div className="status-summary">
          <div className="stat-chip"><span className="stat-value">{searched.length}</span><span className="stat-label">Pending</span></div>
          <div className="stat-chip pending"><span className="stat-value">{counts.PENDING_COLLECTION || 0}</span><span className="stat-label">To collect</span></div>
          <div className="stat-chip done"><span className="stat-value">{counts.VERIFIED || 0}</span><span className="stat-label">To release</span></div>
        </div>
        <div className="compact-filters">
          <div className="df-field"><span>From</span><input type="date" value={fromDate} max={toDate || undefined} onChange={(e) => setFromDate(e.target.value)} /></div>
          <div className="df-field"><span>To</span><input type="date" value={toDate} min={fromDate || undefined} onChange={(e) => setToDate(e.target.value)} /></div>
          {(fromDate || toDate) && (
            <button type="button" className="secondary" onClick={() => { setFromDate(''); setToDate(''); }}>Clear</button>
          )}
          <input placeholder="Search patient, barcode, bill, UMR, test…" value={search} onChange={(e) => setSearch(e.target.value)} />
          <button type="button" className="export-btn" onClick={handleExport} disabled={exporting || visible.length === 0}>
            {exporting ? 'Exporting…' : '⬇ Export Excel'}
          </button>
        </div>
      </div>

      <div className="status-tabs compact" style={{ marginBottom: 10 }}>
        <button type="button" className={`status-tab ${status === '' ? 'active' : ''}`} onClick={() => setStatus('')}>
          All<span className="tab-count">{searched.length}</span>
        </button>
        {PENDING_STAGES.map((s) => (
          <button key={s.key} type="button" className={`status-tab ${status === s.key ? 'active' : ''}`} onClick={() => setStatus(s.key)}>
            {s.label}<span className="tab-count">{counts[s.key] || 0}</span>
          </button>
        ))}
      </div>

      {error && <p className="error-text">{error}</p>}

      <table className="orders-table pending-table">
        <thead>
          <tr>
            <th>Patient Name</th><th>Barcode</th><th>Bill No</th><th>UMR No</th><th>Test Name</th><th>Test Status</th><th>Waiting</th>
          </tr>
        </thead>
        <tbody>
          {visible.map((r) => (
            <tr key={r.sampleId}>
              <td>
                <div className="cell-main">{r.patientName}</div>
                <div className="cell-sub">
                  {[formatAge(r.age, r.ageUnit), r.gender].filter(Boolean).join(' / ')}
                  {r.priority && r.priority !== 'ROUTINE' && <span className="priority-flag">{r.priority}</span>}
                </div>
              </td>
              <td className="mono">{r.barcode}</td>
              <td>
                <div className="cell-main">{r.billNo}</div>
                <div className="cell-sub">{r.walkInDate}</div>
              </td>
              <td>{r.umr}</td>
              <td>{r.testName}</td>
              <td><StatusPill status={r.status} /></td>
              <td className="cell-sub" title={`Registered ${new Date(r.registeredAt).toLocaleString('en-IN')}`}>{waitingFor(r.registeredAt)}</td>
            </tr>
          ))}
          {!loading && visible.length === 0 && (
            <tr><td colSpan={7} className="empty-row">No pending tests for this date range 🎉</td></tr>
          )}
          {loading && <tr><td colSpan={7} className="empty-row">Loading…</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

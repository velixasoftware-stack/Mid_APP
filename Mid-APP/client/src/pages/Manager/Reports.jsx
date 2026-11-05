import { useEffect, useState } from 'react';
import api from '../../api/client';
import { downloadFile } from '../../utils/download';
import { Icon } from '../../components/Icons';

/** ₹ with Indian digit grouping, e.g. ₹1,05,000. */
function inr(n) {
  return `₹${Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
}

// Same stage colours as the Orders / Laboratory screens.
const STATUS_TONE = {
  PENDING_COLLECTION: 'amber', COLLECTED: 'sky', RESULT_ENTERED: 'blue', VERIFIED: 'teal', RELEASED: 'green', CANCELLED: 'rose',
};
const STATUS_LABEL = {
  PENDING_COLLECTION: 'Pending collection', COLLECTED: 'Collected', RESULT_ENTERED: 'Result entered',
  VERIFIED: 'Verified', RELEASED: 'Released', CANCELLED: 'Cancelled',
};

/** A coloured KPI tile - tinted background, accent bar, icon and coloured value. */
function Kpi({ tone, icon, label, value, hint }) {
  return (
    <div className={`kpi kpi-${tone}`}>
      {icon && <span className="kpi-icon"><Icon name={icon} size={16} /></span>}
      <div className="kpi-body">
        <div className="kpi-value">{value}</div>
        <div className="kpi-label">{label}</div>
        {hint && <div className="kpi-hint">{hint}</div>}
      </div>
    </div>
  );
}

/** One audit step on Lab Details: when it happened, and by whom underneath. */
function AuditCell({ at, by, note }) {
  if (!at) return <td>—</td>;
  return (
    <td className="audit-cell">
      {new Date(at).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: '2-digit', hour: 'numeric', minute: '2-digit' })}
      {by && <div className="audit-by">by {by}</div>}
      {note && <div className="audit-by" title={note}>“{note}”</div>}
    </td>
  );
}

/** A minimal inline bar chart - no charting library needed for a handful of bars. */
function BarChart({ data, valueKey, labelKey }) {
  if (data.length === 0) return <p style={{ color: '#94a3b8', fontSize: 13 }}>No data for this period.</p>;

  const w = 640, h = 200, pad = 28, gap = 10;
  const max = Math.max(...data.map((d) => Number(d[valueKey])), 1);
  // Capped so a short range (e.g. 2 days) doesn't draw two half-chart-wide slabs.
  const barW = Math.min(56, Math.max(8, (w - pad * 2 - gap * (data.length - 1)) / data.length));

  return (
    <svg width="100%" height={h} viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="xMinYMid meet">
      <defs>
        <linearGradient id="barFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#6366f1" />
          <stop offset="100%" stopColor="#2563eb" />
        </linearGradient>
      </defs>
      <line x1={pad} y1={h - pad} x2={w - 4} y2={h - pad} stroke="#e2e8f0" strokeWidth="1" />
      {data.map((d, i) => {
        const value = Number(d[valueKey]);
        const barH = ((h - pad * 2) * value) / max;
        const x = pad + i * (barW + gap);
        const y = h - pad - barH;
        return (
          <g key={i}>
            <rect x={x} y={y} width={barW} height={barH} rx="4" fill="url(#barFill)" />
            <text x={x + barW / 2} y={h - pad + 14} fontSize="9" fill="#64748b" textAnchor="middle">
              {String(d[labelKey]).slice(5)}
            </text>
            <text x={x + barW / 2} y={y - 4} fontSize="9" fill="#334155" textAnchor="middle">
              {value >= 1000 ? `${(value / 1000).toFixed(1)}k` : value}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

/** YYYY-MM-DD for a date in the browser's own (local) calendar. */
function ymd(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
// Opens on the last 2 days (yesterday + today) rather than all-time.
function defaultRange() {
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  return { from: ymd(yesterday), to: ymd(today) };
}

export default function Reports() {
  const [fromDate, setFromDate] = useState(() => defaultRange().from);
  const [toDate, setToDate] = useState(() => defaultRange().to);
  const [breakdown, setBreakdown] = useState({ byMode: [], byUser: [] });
  const [collection, setCollection] = useState(null);
  const [outstanding, setOutstanding] = useState([]);
  const [labSummary, setLabSummary] = useState(null);
  const [testRevenue, setTestRevenue] = useState([]);
  const [reportStatus, setReportStatus] = useState(null);
  const [transactions, setTransactions] = useState([]);
  const [groupBy, setGroupBy] = useState('day');
  const [labDetails, setLabDetails] = useState([]);

  const dateParams = { from: fromDate || undefined, to: toDate || undefined };

  useEffect(() => {
    api.get('/reports/collection-summary', { params: dateParams }).then((r) => setCollection(r.data));
    api.get('/reports/outstanding', { params: dateParams }).then((r) => setOutstanding(r.data));
    api.get('/reports/lab-summary', { params: dateParams }).then((r) => setLabSummary(r.data));
    api.get('/reports/test-wise-revenue', { params: dateParams }).then((r) => setTestRevenue(r.data));
    api.get('/reports/report-status', { params: dateParams }).then((r) => setReportStatus(r.data));
    api.get('/reports/lab-details', { params: dateParams }).then((r) => setLabDetails(r.data));
    api.get('/reports/payment-breakdown', { params: dateParams }).then((r) => setBreakdown(r.data));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fromDate, toDate]);

  useEffect(() => {
    api.get('/reports/transactions', { params: { ...dateParams, groupBy } }).then((r) => setTransactions(r.data));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fromDate, toDate, groupBy]);

  function exportUrl() {
    // URLSearchParams stringifies `undefined` as the literal text "undefined"
    // (unlike axios's `params`, which drops it) - only add a param when it's
    // actually set, or the date filter breaks server-side.
    const entries = { ...dateParams, groupBy };
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(entries)) {
      if (value) params.set(key, value);
    }
    return `/reports/export?${params.toString()}`;
  }

  const outstandingAmt = Number(collection?.outstanding || 0);
  const collectedPct = Number(collection?.totalBilled) > 0
    ? Math.round((Number(collection.totalCollected || 0) / Number(collection.totalBilled)) * 100)
    : null;

  return (
    <div>
      <div className="dash-bar no-print">
        <div className="dash-bar-title">
          <span className="dash-bar-icon"><Icon name="reports" size={16} /></span>
          <div>
            <strong>Reports Dashboard</strong>
            <span>{fromDate || toDate ? `${fromDate || '…'} → ${toDate || 'today'}` : 'All dates'}</span>
          </div>
        </div>
        <div className="dash-bar-controls">
          <div className="df-field"><span>From</span>
            <input type="date" value={fromDate} max={toDate || undefined} onChange={(e) => setFromDate(e.target.value)} />
          </div>
          <div className="df-field"><span>To</span>
            <input type="date" value={toDate} min={fromDate || undefined} onChange={(e) => setToDate(e.target.value)} />
          </div>
          {(fromDate !== defaultRange().from || toDate !== defaultRange().to) && (
            <button type="button" className="dash-btn ghost" onClick={() => { const d = defaultRange(); setFromDate(d.from); setToDate(d.to); }}>
              Last 2 days
            </button>
          )}
          {(fromDate || toDate) && (
            <button type="button" className="dash-btn ghost" onClick={() => { setFromDate(''); setToDate(''); }}>All dates</button>
          )}
          <button type="button" className="dash-btn excel" onClick={() => downloadFile(exportUrl(), 'reports-export.xlsx')}>
            ⬇ Export Excel
          </button>
          <button type="button" className="dash-btn pdf" onClick={() => window.print()}>
            <Icon name="print" size={13} /> Print / PDF
          </button>
        </div>
      </div>

      <div className="kpi-row kpi-7">
        <Kpi tone="indigo" icon="orders" label="Bills" value={collection?.billCount ?? '—'} />
        <Kpi tone="blue" icon="billing" label="Gross Amount" value={inr(collection?.totalBilled)} hint="Before discount" />
        {/* Bill.discount already includes any post-billing discount, so it is one tile, split in the hint. */}
        <Kpi
          tone="amber" icon="percent" label="Discount" value={inr(collection?.totalDiscount)}
          hint={Number(collection?.totalPostDiscount) > 0 ? `incl. ${inr(collection.totalPostDiscount)} post-billing` : 'At billing'}
        />
        <Kpi
          tone="sky" icon="invoice" label="Net Amount" value={inr(collection?.netAmount)}
          hint={Number(collection?.totalTax) > 0 ? `incl. ${inr(collection.totalTax)} GST` : 'Gross − discount'}
        />
        <Kpi
          tone="green" icon="invoice" label="Total Collected" value={inr(collection?.totalCollected)}
          hint={collectedPct != null ? `${collectedPct}% of billed` : null}
        />
        <Kpi tone="rose" icon="refund" label="Cancelled / Refunded" value={inr(collection?.totalRefunded)} />
        <Kpi
          tone={outstandingAmt > 0 ? 'orange' : 'teal'} icon="clock" label="Outstanding" value={inr(collection?.outstanding)}
          hint={outstandingAmt > 0 ? 'To be collected' : 'All settled'}
        />
      </div>

      <div className="report-split">
        <div className="card">
          <h3>Payment Mode-wise</h3>
          <table>
            <thead><tr><th>Payment Mode</th><th>Payments</th><th>Collected</th><th>Refunded / Paid Back</th><th>Net</th></tr></thead>
            <tbody>
              {breakdown.byMode.map((m) => (
                <tr key={m.mode}>
                  <td>{m.mode}</td><td>{m.payments}</td><td>{inr(m.collected)}</td><td>{inr(m.refunded)}</td><td><strong>{inr(m.net)}</strong></td>
                </tr>
              ))}
              {breakdown.byMode.length === 0 && <tr><td colSpan={5}>No payments in this period.</td></tr>}
            </tbody>
            {breakdown.byMode.length > 1 && (
              <tfoot>
                <tr>
                  <th>Total</th><th>{breakdown.byMode.reduce((s, m) => s + m.payments, 0)}</th>
                  <th>{inr(breakdown.byMode.reduce((s, m) => s + m.collected, 0))}</th>
                  <th>{inr(breakdown.byMode.reduce((s, m) => s + m.refunded, 0))}</th>
                  <th>{inr(breakdown.byMode.reduce((s, m) => s + m.net, 0))}</th>
                </tr>
              </tfoot>
            )}
          </table>
        </div>

        <div className="card">
          <h3>User-wise</h3>
          <table>
            <thead>
              <tr><th>User</th><th>Bills</th><th>Gross</th><th>Discount</th><th>Net</th><th>Collected</th><th>Refunded</th><th>Outstanding</th></tr>
            </thead>
            <tbody>
              {breakdown.byUser.map((u) => (
                <tr key={u.user}>
                  <td>{u.user}</td><td>{u.bills}</td><td>{inr(u.gross)}</td><td>{inr(u.discount)}</td>
                  <td><strong>{inr(u.net)}</strong></td><td>{inr(u.collected)}</td><td>{inr(u.refunded)}</td><td>{inr(u.outstanding)}</td>
                </tr>
              ))}
              {breakdown.byUser.length === 0 && <tr><td colSpan={8}>No bills in this period.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <div className="topbar">
          <h3 style={{ margin: 0 }}>Transactions</h3>
          <select value={groupBy} onChange={(e) => setGroupBy(e.target.value)} style={{ width: 160 }} className="no-print">
            <option value="day">Day-wise</option>
            <option value="month">Month-wise</option>
          </select>
        </div>
        <BarChart data={transactions} valueKey="totalAmount" labelKey="period" />
        <table style={{ marginTop: 12 }}>
          <thead><tr><th>Period</th><th>Bill Count</th><th>Total Amount</th></tr></thead>
          <tbody>
            {transactions.map((t) => <tr key={t.period}><td>{t.period}</td><td>{t.billCount}</td><td>{inr(t.totalAmount)}</td></tr>)}
            {transactions.length === 0 && <tr><td colSpan={3}>No transactions.</td></tr>}
          </tbody>
        </table>
      </div>

      <div className="card">
        <h3>Lab Summary</h3>
        <div className="kpi-row compact">
          {labSummary && Object.entries(labSummary.byStatus).map(([status, count]) => (
            <Kpi key={status} tone={STATUS_TONE[status] || 'slate'} label={STATUS_LABEL[status] || status} value={count} />
          ))}
        </div>
      </div>

      <div className="card">
        <h3>Report Status (Pending / Verified / Released)</h3>
        <div className="kpi-row compact">
          <Kpi tone="amber" label="Pending" value={reportStatus?.PENDING ?? 0} />
          <Kpi tone="teal" label="Verified" value={reportStatus?.VERIFIED ?? 0} />
          <Kpi tone="green" label="Released" value={reportStatus?.RELEASED ?? 0} />
        </div>
      </div>

      <div className="card">
        <h3>Test-wise Counts & Revenue</h3>
        <table>
          <thead><tr><th>Test Code</th><th>Test Name</th><th>Count</th><th>Revenue</th></tr></thead>
          <tbody>
            {testRevenue.map((t) => <tr key={t.testCode}><td>{t.testCode}</td><td>{t.testName}</td><td>{t.count}</td><td>₹{t.revenue}</td></tr>)}
            {testRevenue.length === 0 && <tr><td colSpan={4}>No data.</td></tr>}
          </tbody>
        </table>
      </div>

      <div className="card">
        <h3>Outstanding Amounts</h3>
        <table>
          <thead><tr><th>Bill No</th><th>Patient</th><th>Total</th><th>Discount</th><th>Paid</th><th>Refunded</th><th>Post-Billing Discount</th><th>Outstanding</th></tr></thead>
          <tbody>
            {outstanding.map((o) => (
              <tr key={o.billNo}>
                <td>{o.billNo}</td><td>{o.patient}</td><td>₹{o.totalAmount}</td><td>₹{o.discount || 0}</td><td>₹{o.paidAmount}</td>
                <td>₹{o.refundedAmount || 0}</td><td>₹{o.postDiscountAmount || 0}</td><td>₹{o.outstanding}</td>
              </tr>
            ))}
            {outstanding.length === 0 && <tr><td colSpan={8}>No outstanding bills.</td></tr>}
          </tbody>
        </table>
      </div>

      <div className="card">
        <h3>Lab Details (Samples)</h3>
        <table className="lab-audit-table">
          <thead>
            <tr>
              <th>Barcode</th><th>Test Code</th><th>Test Name</th><th>Bill / Patient</th>
              <th>Sample Status</th><th>Report Status</th>
              <th>Registered</th><th>Collected</th><th>Result Entered</th><th>Verified</th><th>Released</th><th>Revoked</th><th>Last Update</th>
            </tr>
          </thead>
          <tbody>
            {labDetails.map((d) => (
              <tr key={d.barcode}>
                <td>{d.barcode}</td><td>{d.testCode}</td><td>{d.testName}</td>
                <td>{d.billNo || '—'}<div className="audit-by">{[d.patientName, d.umr].filter(Boolean).join(' · ')}</div></td>
                <td>{d.itemStatus === 'CANCELLED' ? 'Cancelled' : (STATUS_LABEL[d.status] || d.status)}</td>
                <td>{d.reportStatus || '—'}</td>
                <AuditCell at={d.registeredAt} by={d.registeredBy} />
                <AuditCell at={d.collectedAt} by={d.collectedBy} />
                <AuditCell at={d.resultEnteredAt} by={d.resultEnteredBy} />
                <AuditCell at={d.verifiedAt} by={d.verifiedBy} />
                <AuditCell at={d.releasedAt} by={d.releasedBy} />
                <AuditCell at={d.revokedAt} by={d.revokedBy} note={d.revokedReason} />
                <AuditCell at={d.lastUpdatedAt} by={d.lastUpdatedBy} />
              </tr>
            ))}
            {labDetails.length === 0 && <tr><td colSpan={13}>No samples.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

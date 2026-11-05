import { useEffect, useState } from 'react';
import api from '../../api/client';
import { downloadFile } from '../../utils/download';
import { Icon } from '../../components/Icons';

export default function SalesDashboard() {
  const [summary, setSummary] = useState([]);
  const [details, setDetails] = useState([]);
  // true for a MARKETING user: Total Monthly Revenue is not shown to them.
  const [hideRevenue, setHideRevenue] = useState(false);
  const [search, setSearch] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');

  useEffect(() => {
    api.get('/chief-admin-users/sales-report', { params: { from: fromDate || undefined, to: toDate || undefined } }).then((r) => {
      setSummary(r.data.summary);
      setDetails(r.data.details);
      setHideRevenue(!!r.data.hideRevenue);
    });
  }, [fromDate, toDate]);

  const filteredDetails = details.filter((d) => {
    const q = search.toLowerCase();
    if (!q) return true;
    return d.salesPerson.toLowerCase().includes(q)
      || d.clientCode.toLowerCase().includes(q)
      || d.clientName.toLowerCase().includes(q);
  });

  const totals = summary.reduce((acc, s) => ({
    clientCount: acc.clientCount + s.clientCount,
    totalMonthlyRevenue: acc.totalMonthlyRevenue + (s.totalMonthlyRevenue || 0),
    totalMarketingPersonPrice: acc.totalMarketingPersonPrice + (s.totalMarketingPersonPrice || 0),
    paymentsCollected: acc.paymentsCollected + (s.paymentsCollected || 0),
  }), { clientCount: 0, totalMonthlyRevenue: 0, totalMarketingPersonPrice: 0, paymentsCollected: 0 });

  function exportUrl() {
    const params = new URLSearchParams();
    if (fromDate) params.set('from', fromDate);
    if (toDate) params.set('to', toDate);
    const qs = params.toString();
    return `/chief-admin-users/sales-report/export${qs ? `?${qs}` : ''}`;
  }

  const dateFiltered = Boolean(fromDate || toDate);

  return (
    <div>
      <div className="topbar">
        <h3 style={{ margin: 0 }}>Marketing / Sales Dashboard</h3>
        <button onClick={() => downloadFile(exportUrl(), 'marketing-sales-report.xlsx')}>
          Export to Excel
        </button>
      </div>

      <div className="card date-filter-bar no-print">
        <div className="df-title"><Icon name="calendar" size={15} /> Filter by Date</div>
        <div className="df-controls">
          <div className="df-field"><span>From</span>
            <input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
          </div>
          <div className="df-field"><span>To</span>
            <input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} />
          </div>
          {dateFiltered && (
            <button type="button" className="secondary" onClick={() => { setFromDate(''); setToDate(''); }}>Clear</button>
          )}
        </div>
        <p className="df-note">
          "Clients Onboarded" is scoped to clients created in this range; "Payments Collected" is scoped to
          payments received in this range, regardless of when that client was onboarded.
        </p>
      </div>

      <div className="stat-row">
        <div className="stat-tile"><div className="value">{summary.length}</div><div className="label">Marketing Persons</div></div>
        <div className="stat-tile"><div className="value">{totals.clientCount}</div><div className="label">Clients Onboarded{dateFiltered ? ' (range)' : ''}</div></div>
        {!hideRevenue && <div className="stat-tile"><div className="value">₹{totals.totalMonthlyRevenue}</div><div className="label">Total Monthly Revenue</div></div>}
        <div className="stat-tile"><div className="value">₹{totals.totalMarketingPersonPrice}</div><div className="label">Total Marketing Person Price</div></div>
        <div className="stat-tile"><div className="value">₹{totals.paymentsCollected}</div><div className="label">Payments Collected{dateFiltered ? ' (range)' : ''}</div></div>
      </div>

      <div className="card">
        <h3 style={{ marginTop: 0 }}>Summary by Marketing Person</h3>
        <table>
          <thead>
            <tr>
              <th>Sales Person</th><th>Clients Onboarded</th><th>Marketing Person Price</th>{!hideRevenue && <th>Total Monthly Revenue</th>}
              <th>Payments Collected</th><th>Paid</th><th>Pending</th><th>Expired</th>
            </tr>
          </thead>
          <tbody>
            {summary.map((s) => (
              <tr key={s.salesPerson}>
                <td>{s.name} <span style={{ color: '#94a3b8', fontSize: 12 }}>({s.salesPerson})</span></td>
                <td>{s.clientCount}</td>
                <td>₹{s.totalMarketingPersonPrice}</td>
                {!hideRevenue && <td>₹{s.totalMonthlyRevenue}</td>}
                <td>₹{s.paymentsCollected}</td>
                <td><span className="badge PAID">{s.paid}</span></td>
                <td><span className="badge PENDING">{s.pending}</span></td>
                <td><span className="badge EXPIRED">{s.expired}</span></td>
              </tr>
            ))}
            {summary.length === 0 && <tr><td colSpan={8}>No marketing persons or client attributions yet.</td></tr>}
          </tbody>
        </table>
      </div>

      <div className="card">
        <div className="topbar">
          <h3 style={{ margin: 0 }}>Client Details</h3>
          <input placeholder="Search by sales person, client code or name…" value={search} onChange={(e) => setSearch(e.target.value)} style={{ width: 300, maxWidth: '100%' }} />
        </div>
        <table>
          <thead>
            <tr><th>Sales Person</th><th>Client Code</th><th>Client Name</th><th>Marketing Person Price</th><th>Monthly Amount</th><th>Status</th><th>Created On</th></tr>
          </thead>
          <tbody>
            {filteredDetails.map((d) => (
              <tr key={d.clientCode}>
                <td>{d.salesPerson}</td>
                <td>{d.clientCode}</td>
                <td>{d.clientName}</td>
                <td>₹{d.marketingPersonPrice}</td>
                <td>₹{d.monthlyAmount}</td>
                <td><span className={`badge ${d.paymentStatus}`}>{d.paymentStatus}</span></td>
                <td>{new Date(d.createdAt).toLocaleDateString()}</td>
              </tr>
            ))}
            {filteredDetails.length === 0 && <tr><td colSpan={7}>No clients found.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../../api/client';
import { Icon } from '../../components/Icons';

function StatCard({ icon, color, value, label }) {
  return (
    <div className="dash-stat-card">
      <div className={`dash-stat-icon ${color}`}><Icon name={icon} size={19} /></div>
      <div>
        <div className="dash-stat-value">{value}</div>
        <div className="dash-stat-label">{label}</div>
      </div>
    </div>
  );
}

export default function Dashboard() {
  const [data, setData] = useState({ summary: {}, clients: [] });
  const [statusFilter, setStatusFilter] = useState('');
  const [search, setSearch] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    const { data } = await api.get('/clients', {
      params: {
        status: statusFilter || undefined,
        from: fromDate || undefined,
        to: toDate || undefined,
      },
    });
    setData(data);
    setLoading(false);
  }

  useEffect(() => { load(); }, [statusFilter, fromDate, toDate]);

  const { summary, clients } = data;
  const q = search.trim().toLowerCase();
  const filteredClients = q
    ? clients.filter((c) => c.clientCode?.toLowerCase().includes(q) || c.clientName?.toLowerCase().includes(q))
    : clients;
  const dateFiltered = Boolean(fromDate || toDate);

  return (
    <div>
      <div className="dash-header no-print">
        <div className="mark-icon"><Icon name="dashboard" size={20} /></div>
        <div>
          <h2>Dashboard</h2>
          <p>Overview of every client, their payment status, and revenue across the platform.</p>
        </div>
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
          Scopes Lab Bills/Lab Revenue/Payments Collected below to this date range. Client status counts and
          this-cycle SaaS revenue always reflect right now, regardless of the range.
        </p>
      </div>

      <p className="dash-section-label">Client Status</p>
      <div className="dash-stat-grid">
        <StatCard icon="building" color="blue" value={summary.total || 0} label="Total Clients" />
        <StatCard icon="team" color="green" value={summary.paid || 0} label="Paid" />
        <StatCard icon="clock" color="amber" value={summary.pending || 0} label="Pending" />
        <StatCard icon="close" color="red" value={summary.expired || 0} label="Expired" />
      </div>

      <p className="dash-section-label">Revenue</p>
      <div className="dash-stat-grid">
        {/* Subscription revenue totals - not sent to MARKETING users (null), so not shown. */}
        {summary.monthlyRevenueBooked !== null && (
          <>
            <StatCard icon="invoice" color="teal" value={`₹${summary.monthlyRevenueCollected || 0}`} label="Collected this cycle" />
            <StatCard icon="invoice" color="purple" value={`₹${summary.monthlyRevenueBooked || 0}`} label="Booked this cycle" />
            <StatCard icon="percent" color="indigo" value={`₹${summary.paymentsCollected || 0}`} label={`Payments Collected${dateFiltered ? ' (range)' : ''}`} />
          </>
        )}
        <StatCard icon="reports" color="blue" value={summary.labBillCount || 0} label={`Lab Bills${dateFiltered ? ' (range)' : ' (all time)'}`} />
        <StatCard icon="lab" color="teal" value={`₹${summary.labRevenueCollected || 0}`} label={`Lab Revenue${dateFiltered ? ' (range)' : ' (all time)'}`} />
      </div>

      <div className="card">
        <div className="topbar">
          <h3 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}><Icon name="team" size={16} /> Clients</h3>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', maxWidth: '100%' }}>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by client code or name…"
              style={{ width: 240, maxWidth: '100%' }}
            />
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} style={{ width: 180, maxWidth: '100%' }}>
              <option value="">All statuses</option>
              <option value="PAID">Paid</option>
              <option value="PENDING">Pending</option>
              <option value="EXPIRED">Expired</option>
            </select>
          </div>
        </div>
        {loading ? <p>Loading…</p> : (
          <table className="dash-table">
            <thead>
              <tr>
                <th>Client Code</th><th>Name</th><th>Mobile</th><th>Sales Person</th>
                <th>Monthly Amount</th><th>Users</th><th>Status</th><th>Paid Through</th>
                <th>Payments{dateFiltered ? ' (range)' : ''}</th>
                <th>Lab Bills</th><th>Lab Revenue</th><th></th>
              </tr>
            </thead>
            <tbody>
              {filteredClients.map((c) => (
                <tr key={c.id}>
                  <td><span className="dash-client-code">{c.clientCode}</span></td>
                  <td>{c.clientName}</td>
                  <td>{c.mobile}</td>
                  <td>{c.salesPerson}</td>
                  <td>₹{c.monthlyAmount}</td>
                  <td>{c.userCount}</td>
                  <td><span className={`badge ${c.paymentStatus}`}>{c.paymentStatus}</span></td>
                  <td>{c.paidThrough ? new Date(c.paidThrough).toLocaleDateString() : '—'}</td>
                  <td>₹{c.paymentsCollected}</td>
                  <td>{c.labBillCount}</td>
                  <td>₹{c.labRevenueCollected}</td>
                  <td>
                    <Link to={`/chief-admin/clients/${c.id}`} className="icon-btn" title="Edit client">
                      <Icon name="edit" size={15} />
                    </Link>
                  </td>
                </tr>
              ))}
              {filteredClients.length === 0 && <tr><td colSpan={12}>No clients found.</td></tr>}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

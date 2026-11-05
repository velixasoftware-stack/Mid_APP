import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import RoleCheckboxes from '../../components/RoleCheckboxes';
import SearchSelect from '../../components/SearchSelect';
import { calculatePlanAmount, BASE_USER_COUNT, BASE_MONTHLY_AMOUNT, EXTRA_USER_AMOUNT } from '../../utils/pricing';

function blankUser() {
  return { username: '', password: '', name: '', department: '', designation: '', roleNames: ['FRONT_OFFICE'] };
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

export default function ClientCreate() {
  const { auth } = useAuth();
  // A MARKETING user (no ADMIN role) always creates clients assigned to themselves.
  const marketingSelf = !(auth?.user?.roles || []).includes('ADMIN') ? auth?.user?.username : null;
  const [form, setForm] = useState({
    clientName: '', mobile: '', email: '', address: '', salesPerson: '', marketingPersonPrice: '0',
    startDate: todayISO(), endDate: '', qrPaymentRequired: true, isFreeTrial: false,
  });
  const [userCount, setUserCount] = useState(1);
  const [userRows, setUserRows] = useState([blankUser()]);
  const [monthlyAmountOverride, setMonthlyAmountOverride] = useState(null); // null = auto-calculated from the plan
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [marketingPersons, setMarketingPersons] = useState([]);
  const [nextClientCode, setNextClientCode] = useState('');
  const navigate = useNavigate();

  useEffect(() => {
    api.get('/clients/marketing-persons').then((r) => setMarketingPersons(r.data));
    api.get('/clients/next-code').then((r) => setNextClientCode(r.data.clientCode));
  }, []);

  function update(field, value) { setForm((f) => ({ ...f, [field]: value })); }

  const calculatedMonthlyAmount = calculatePlanAmount(userCount) + (Number(form.marketingPersonPrice) || 0);
  const totalMonthlyAmount = monthlyAmountOverride ?? calculatedMonthlyAmount;

  function handleUserCountChange(value) {
    const count = Math.max(1, Math.min(20, Number(value) || 1));
    setUserCount(count);
    setUserRows((rows) => {
      const next = rows.slice(0, count);
      while (next.length < count) next.push(blankUser());
      return next;
    });
  }

  function updateUserRow(index, field, value) {
    setUserRows((rows) => rows.map((row, i) => (i === index ? { ...row, [field]: value } : row)));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');

    if (!form.startDate || !form.endDate) {
      setError('Start Date and End Date are required');
      return;
    }
    if (form.endDate < form.startDate) {
      setError('End Date cannot be before Start Date');
      return;
    }
    const seen = new Set();
    for (const u of userRows) {
      const name = (u.username || '').trim();
      if (!name || !u.password) {
        setError('Every user needs a username and password');
        return;
      }
      if (u.roleNames.length === 0) {
        setError('Every user needs at least one role');
        return;
      }
      // "chiefadmin" is created automatically as this client's support login.
      if (name.toLowerCase() === 'chiefadmin') {
        setError(`"${name}" is reserved for the Chief Admin support login - please use another username (e.g. admin).`);
        return;
      }
      if (seen.has(name.toLowerCase())) {
        setError(`Username "${name}" is entered more than once - each user needs a different username.`);
        return;
      }
      seen.add(name.toLowerCase());
    }

    setLoading(true);
    try {
      const payload = { ...form, users: userRows };
      if (monthlyAmountOverride != null) payload.monthlyAmount = monthlyAmountOverride;
      const { data } = await api.post('/clients', payload);
      setResult(data);
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to create client');
    } finally {
      setLoading(false);
    }
  }

  if (result) {
    return (
      <div className="card">
        <h3>Client "{result.client.clientName}" created (Code: {result.client.clientCode})</h3>
        <p>Subscription: {form.startDate} to {form.endDate} · ₹{result.client.monthlyAmount}/month</p>
        <table>
          <thead><tr><th>Username</th><th>Roles</th></tr></thead>
          <tbody>
            {result.users.map((u) => <tr key={u.id}><td>{u.username}</td><td>{u.roles.join(', ')}</td></tr>)}
          </tbody>
        </table>
        {result.systemUser && (
          <div style={{ marginTop: 16, background: '#fef9c3', border: '1px solid #fde68a', borderRadius: 8, padding: 12 }}>
            <strong>Chief Admin support login:</strong>
            <p style={{ margin: '6px 0 0' }}>
              Client Code <strong>{result.client.clientCode}</strong> · Username <strong>{result.systemUser.username}</strong> ·
              Password <strong>{result.systemUser.password}</strong>
            </p>
            <p style={{ margin: '6px 0 0', fontSize: 12, color: '#854d0e' }}>
              This is the standard Chief Admin support password, the same on every client - nothing to write down.
              It isn't counted as one of this client's billable users. You can also skip typing it entirely via
              "Log In as This Client" on this client's detail page.
            </p>
          </div>
        )}
        <button style={{ marginTop: 16 }} onClick={() => navigate('/chief-admin')}>
          Done — Back to Dashboard
        </button>
      </div>
    );
  }

  return (
    <div className="card">
      <h3>Create Client</h3>
      <form onSubmit={handleSubmit}>
        <div className="form-grid">
          <label><span>Client Code</span>
            <input value={nextClientCode || 'Generating…'} disabled />
          </label>
          <label><span>Client Name</span><input value={form.clientName} onChange={(e) => update('clientName', e.target.value)} required /></label>
          <label><span>Mobile</span><input value={form.mobile} onChange={(e) => update('mobile', e.target.value)} /></label>
          <label><span>Email</span><input value={form.email} onChange={(e) => update('email', e.target.value)} /></label>
          <label><span>Address</span><input value={form.address} onChange={(e) => update('address', e.target.value)} /></label>
          {marketingSelf ? (
            <label><span>Sales Person</span>
              <input value={marketingSelf} disabled title="Clients you create are assigned to you" />
            </label>
          ) : (
            <div><span>Sales Person</span>
              <SearchSelect
                options={marketingPersons.map((m) => ({ value: m.username, label: `${m.name || m.username} (${m.username})` }))}
                value={form.salesPerson}
                onChange={(v) => update('salesPerson', v)}
                placeholder="Search marketing person…"
              />
            </div>
          )}
          <label><span>Marketing Person Price (₹/month)</span>
            <input type="number" min={0} value={form.marketingPersonPrice} onChange={(e) => update('marketingPersonPrice', e.target.value)} />
          </label>
          <label><span>Subscription Start Date</span>
            <input type="date" value={form.startDate} onChange={(e) => update('startDate', e.target.value)} required />
          </label>
          <label><span>Subscription End Date</span>
            <input type="date" value={form.endDate} onChange={(e) => update('endDate', e.target.value)} required />
          </label>
          <label><span>Free Trial</span>
            <select value={form.isFreeTrial ? 'yes' : 'no'} onChange={(e) => update('isFreeTrial', e.target.value === 'yes')}>
              <option value="no">No — charge for this first cycle</option>
              <option value="yes">Yes — this first cycle (the dates above) is free</option>
            </select>
          </label>
          <label><span>Number of Users</span>
            <input type="number" min={1} max={20} value={userCount} onChange={(e) => handleUserCountChange(e.target.value)} />
          </label>
          <label><span>QR / Online Payment</span>
            <select value={form.qrPaymentRequired ? 'yes' : 'no'} onChange={(e) => update('qrPaymentRequired', e.target.value === 'yes')}>
              <option value="yes">Required — client self-pays via QR</option>
              <option value="no">Not required — I'll record payments manually</option>
            </select>
          </label>
          <div>
            <span style={{ display: 'block', marginBottom: 6, fontWeight: 600, fontSize: 13 }}>Monthly Subscription Amount</span>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <input
                type="number"
                min={0}
                value={totalMonthlyAmount}
                onChange={(e) => setMonthlyAmountOverride(e.target.value === '' ? 0 : Number(e.target.value))}
              />
              {monthlyAmountOverride != null && (
                <button type="button" className="secondary" onClick={() => setMonthlyAmountOverride(null)}>
                  Reset
                </button>
              )}
            </div>
          </div>
        </div>
        <p style={{ fontSize: 13, color: '#64748b', marginTop: -8 }}>
          Plan: ₹{BASE_MONTHLY_AMOUNT}/month covers {BASE_USER_COUNT} users, +₹{EXTRA_USER_AMOUNT}/month per additional
          user, + Marketing Person Price if set — auto-calculated as ₹{calculatedMonthlyAmount}/month above, but you
          can type a different amount to override it for this client (e.g. a custom negotiated rate). This is what's
          billed every month, and multiplies exactly for 3/6/12-month advance payments.
        </p>
        {form.isFreeTrial && (
          <p style={{ fontSize: 13, color: '#166534', marginTop: -8 }}>
            Free Trial is on — the client gets full access from {form.startDate || '…'} through {form.endDate || '…'}
            at no charge. Their next cycle after that will bill the normal monthly amount.
          </p>
        )}

        <h4>Users</h4>
        {userRows.map((u, i) => (
          <div className="form-grid" key={i} style={{ borderTop: '1px solid #eee', paddingTop: 10 }}>
            <label><span>Username</span>
              <input value={u.username} onChange={(e) => updateUserRow(i, 'username', e.target.value)} required />
            </label>
            <label><span>Name</span>
              <input value={u.name} onChange={(e) => updateUserRow(i, 'name', e.target.value)} />
            </label>
            <label><span>Password</span>
              <input type="password" value={u.password} onChange={(e) => updateUserRow(i, 'password', e.target.value)} required />
            </label>
            <label><span>Department</span>
              <input value={u.department} onChange={(e) => updateUserRow(i, 'department', e.target.value)} placeholder="e.g. Laboratory" />
            </label>
            <label><span>Designation</span>
              <input value={u.designation} onChange={(e) => updateUserRow(i, 'designation', e.target.value)} placeholder="e.g. Lab Technician" />
            </label>
            <div><span>Roles</span>
              <RoleCheckboxes value={u.roleNames} onChange={(roleNames) => updateUserRow(i, 'roleNames', roleNames)} />
            </div>
          </div>
        ))}

        {error && <p className="error-text">{error}</p>}
        <button type="submit" disabled={loading} style={{ marginTop: 16 }}>
          {loading ? 'Creating…' : 'Create Client & Users'}
        </button>
      </form>
    </div>
  );
}

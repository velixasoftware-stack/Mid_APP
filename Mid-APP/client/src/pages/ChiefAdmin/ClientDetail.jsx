import { useEffect, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import api from '../../api/client';
import RoleCheckboxes from '../../components/RoleCheckboxes';
import SearchSelect from '../../components/SearchSelect';
import { SCREEN_CATALOG } from '../../components/Layout';
import { calculatePlanAmount } from '../../utils/pricing';
import { useAuth } from '../../context/AuthContext';

export default function ClientDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { auth, impersonateClient } = useAuth();
  // A MARKETING user (no ADMIN role) can open their assigned clients but not
  // change anything - the page renders view-only and skips ADMIN-only data.
  const isAdmin = (auth?.user?.roles || []).includes('ADMIN');
  const readOnly = !isAdmin;
  const [loginAsBusy, setLoginAsBusy] = useState(false);
  const [client, setClient] = useState(null);
  const [form, setForm] = useState(null);
  const [users, setUsers] = useState([]);
  const [subscriptions, setSubscriptions] = useState([]);
  const [tests, setTests] = useState([]);
  const [prices, setPrices] = useState([]);
  const [marketingPersons, setMarketingPersons] = useState([]);
  const [priceForm, setPriceForm] = useState({ testId: '', price: '' });
  const [newUser, setNewUser] = useState({ username: '', password: '', name: '', department: '', designation: '', roleNames: ['FRONT_OFFICE'], locationId: 'ALL' });
  // Locations (branches) of this client; the first one added is Main.
  const [locations, setLocations] = useState([]);
  const [newLocation, setNewLocation] = useState({ name: '', address: '' });
  const [locationEdits, setLocationEdits] = useState({}); // { [locationId]: { name, address } }
  const [locationMessage, setLocationMessage] = useState('');
  const [locationError, setLocationError] = useState('');
  const [userRoleEdits, setUserRoleEdits] = useState({});
  const [userProfileEdits, setUserProfileEdits] = useState({}); // { [userId]: { department, designation } }
  const [signatureUploading, setSignatureUploading] = useState(null); // userId currently uploading
  const [passwordResetFor, setPasswordResetFor] = useState(null); // userId currently entering a new password
  const [newPassword, setNewPassword] = useState('');
  const [passwordSaving, setPasswordSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState('');
  const [error, setError] = useState('');

  const [manualPaymentForm, setManualPaymentForm] = useState({ months: '1', mode: 'Cash', transactionId: '', remarks: '' });
  const [manualPaymentSaving, setManualPaymentSaving] = useState(false);
  const [manualPaymentMessage, setManualPaymentMessage] = useState('');
  const [manualPaymentError, setManualPaymentError] = useState('');
  const [revenue, setRevenue] = useState(null);

  const [freeDays, setFreeDays] = useState('7');
  const [freeDaysSaving, setFreeDaysSaving] = useState(false);
  const [freeDaysMessage, setFreeDaysMessage] = useState('');
  const [freeDaysError, setFreeDaysError] = useState('');

  // Role -> screen access for this client's own staff - `defaults` is the
  // platform-wide ceiling (read-only here, set on Role Screen Defaults),
  // `effective` is this client's own override, editable and saved per role.
  const [roleScreenRoles, setRoleScreenRoles] = useState([]);
  const [roleScreenDefaults, setRoleScreenDefaults] = useState({});
  const [roleScreenEffective, setRoleScreenEffective] = useState({});
  const [roleScreenMessage, setRoleScreenMessage] = useState('');
  const [roleScreenError, setRoleScreenError] = useState('');

  async function load() {
    const [clientRes, testsRes, pricesRes, marketingRes, roleScreensRes, revenueRes, locationsRes] = await Promise.all([
      api.get(`/clients/${id}`),
      isAdmin ? api.get('/admin/masters/tests') : Promise.resolve({ data: [] }),
      api.get(`/clients/${id}/test-prices`),
      api.get('/clients/marketing-persons'),
      isAdmin ? api.get(`/clients/${id}/role-screens`) : Promise.resolve({ data: { roles: [], defaults: {}, effective: {} } }),
      isAdmin ? api.get(`/clients/${id}/revenue`) : Promise.resolve({ data: null }),
      api.get(`/clients/${id}/locations`),
    ]);
    setLocations(locationsRes.data);
    setLocationEdits({});
    setMarketingPersons(marketingRes.data);
    setRoleScreenRoles(roleScreensRes.data.roles);
    setRoleScreenDefaults(roleScreensRes.data.defaults);
    setRoleScreenEffective(roleScreensRes.data.effective);
    setRevenue(revenueRes.data);
    setClient(clientRes.data);
    setForm({
      clientName: clientRes.data.clientName,
      mobile: clientRes.data.mobile || '',
      email: clientRes.data.email || '',
      address: clientRes.data.address || '',
      salesPerson: clientRes.data.salesPerson || '',
      marketingPersonPrice: String(clientRes.data.marketingPersonPrice ?? 0),
      monthlyAmount: clientRes.data.monthlyAmount,
      active: clientRes.data.active,
      allowBillCancellationRefund: clientRes.data.allowBillCancellationRefund,
      qrPaymentRequired: clientRes.data.qrPaymentRequired,
    });
    setUsers(clientRes.data.ClientUsers || []);
    setUserRoleEdits({});
    setSubscriptions(clientRes.data.ClientSubscriptions || []);
    setTests(testsRes.data);
    setPrices(pricesRes.data);
  }

  useEffect(() => { load(); }, [id]);

  async function handleSaveClient(e) {
    e.preventDefault();
    setError('');
    setSaveMessage('');
    try {
      const { monthlyAmount, ...editable } = form;
      await api.put(`/clients/${id}`, editable);
      setSaveMessage('Client details updated.');
      load();
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to update client');
    }
  }

  async function handleLoginAsClient() {
    if (loginAsBusy) return; // guard against rapid double-click firing two impersonation requests
    setError('');
    setLoginAsBusy(true);
    try {
      await impersonateClient(id);
      navigate('/app');
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to log in as this client');
      setLoginAsBusy(false);
    }
  }

  async function handleRecordManualPayment(e) {
    e.preventDefault();
    if (manualPaymentSaving) return; // guard against rapid double-submit recording the payment twice
    setManualPaymentError('');
    setManualPaymentMessage('');
    setManualPaymentSaving(true);
    try {
      const { data } = await api.post(`/clients/${id}/manual-payment`, {
        months: Number(manualPaymentForm.months) || 1,
        mode: manualPaymentForm.mode,
        transactionId: manualPaymentForm.transactionId || undefined,
        remarks: manualPaymentForm.remarks || undefined,
      });
      setManualPaymentMessage(`${data.message} Paid through ${data.paidThrough}.`);
      setManualPaymentForm({ months: '1', mode: 'Cash', transactionId: '', remarks: '' });
      load();
    } catch (err) {
      setManualPaymentError(err.response?.data?.message || 'Failed to record payment');
    } finally {
      setManualPaymentSaving(false);
    }
  }

  async function handleGrantFreeDays(e) {
    e.preventDefault();
    if (freeDaysSaving) return; // guard against rapid double-submit granting it twice
    setFreeDaysError('');
    setFreeDaysMessage('');
    setFreeDaysSaving(true);
    try {
      const { data } = await api.post(`/clients/${id}/free-days`, { days: Number(freeDays) || 0 });
      setFreeDaysMessage(`Granted — free access through ${data.toDate}.`);
      load();
    } catch (err) {
      setFreeDaysError(err.response?.data?.message || 'Failed to grant free days');
    } finally {
      setFreeDaysSaving(false);
    }
  }

  async function handleAddUser(e) {
    e.preventDefault();
    setError('');
    if (newUser.roleNames.length === 0) {
      setError('Select at least one role for the new user');
      return;
    }
    try {
      await api.post(`/clients/${id}/users`, newUser);
      setNewUser({ username: '', password: '', name: '', department: '', designation: '', roleNames: ['FRONT_OFFICE'], locationId: 'ALL' });
      load();
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to create user');
    }
  }

  function rolesForUser(u) {
    return userRoleEdits[u.id] ?? u.Roles?.map((r) => r.name) ?? [];
  }

  async function handleSaveUserRoles(userId) {
    setError('');
    const roleNames = userRoleEdits[userId];
    if (!roleNames || roleNames.length === 0) {
      setError('A user must have at least one role');
      return;
    }
    try {
      await api.put(`/clients/${id}/users/${userId}`, { roleNames });
      load();
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to update roles');
    }
  }

  function profileForUser(u) {
    return userProfileEdits[u.id] ?? { department: u.department || '', designation: u.designation || '' };
  }

  async function handleSaveUserProfile(userId) {
    setError('');
    const profile = userProfileEdits[userId];
    try {
      await api.put(`/clients/${id}/users/${userId}`, profile);
      setUserProfileEdits((edits) => { const next = { ...edits }; delete next[userId]; return next; });
      load();
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to update department/designation');
    }
  }

  async function handleResetPassword(userId) {
    if (passwordSaving) return; // guard against rapid double-submit
    if (!newPassword.trim()) {
      setError('Enter a new password first');
      return;
    }
    setError('');
    setPasswordSaving(true);
    try {
      await api.put(`/clients/${id}/users/${userId}`, { password: newPassword });
      setPasswordResetFor(null);
      setNewPassword('');
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to reset password');
    } finally {
      setPasswordSaving(false);
    }
  }

  async function handleUploadSignature(userId, file) {
    if (!file) return;
    setError('');
    setSignatureUploading(userId);
    try {
      const formData = new FormData();
      formData.append('signature', file);
      await api.post(`/clients/${id}/users/${userId}/signature`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      load();
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to upload signature');
    } finally {
      setSignatureUploading(null);
    }
  }

  // Each tick/untick saves straight away - there is no separate Save button
  // to forget. On failure the box flips back.
  async function toggleRoleScreen(role, key) {
    const before = roleScreenEffective[role] || [];
    const next = before.includes(key) ? before.filter((k) => k !== key) : [...before, key];
    setRoleScreenEffective((d) => ({ ...d, [role]: next }));
    setRoleScreenError('');
    setRoleScreenMessage('');
    try {
      await api.put(`/clients/${id}/role-screens`, { role, screens: next });
      const label = SCREEN_CATALOG.find((s) => s.key === key)?.label || key;
      setRoleScreenMessage(`Saved - ${label} ${next.includes(key) ? 'enabled' : 'removed'} for ${role}.`);
    } catch (err) {
      setRoleScreenEffective((d) => ({ ...d, [role]: before }));
      setRoleScreenError(err.response?.data?.message || 'Failed to save');
    }
  }

  async function handleAddLocation(e) {
    e.preventDefault();
    setLocationError('');
    setLocationMessage('');
    try {
      const { data } = await api.post(`/clients/${id}/locations`, newLocation);
      setNewLocation({ name: '', address: '' });
      setLocationMessage(data.isMain
        ? `${data.name} added as the Main location.`
        : `${data.name} added. It uses the Main location's prices until the client sets its own.`);
      load();
    } catch (err) {
      setLocationError(err.response?.data?.message || 'Failed to add location');
    }
  }

  async function handleUpdateLocation(locationId, changes) {
    setLocationError('');
    setLocationMessage('');
    try {
      await api.put(`/clients/${id}/locations/${locationId}`, changes);
      setLocationMessage('Location saved.');
      load();
    } catch (err) {
      setLocationError(err.response?.data?.message || 'Failed to save location');
    }
  }

  // Saves straight away, like the role ticks - 'ALL' or a location id.
  async function handleSetUserLocation(userId, locationId) {
    setError('');
    try {
      await api.put(`/clients/${id}/users/${userId}`, { locationId });
      load();
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to change location');
    }
  }

  async function handleSetPrice(e) {
    e.preventDefault();
    setError('');
    try {
      await api.put(`/clients/${id}/test-prices`, { testId: Number(priceForm.testId), price: Number(priceForm.price) });
      setPriceForm({ testId: '', price: '' });
      load();
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to set price');
    }
  }

  const billableUsers = users.filter((u) => !u.isSystemUser);
  const activeLocations = locations.filter((l) => l.active);
  // Location access only matters once the client has more than one location.
  const multiLocation = activeLocations.length > 1;
  const userLocationValue = (u) => (u.allLocations || !u.locationId ? 'ALL' : String(u.locationId));

  if (!client || !form) return <p>Loading…</p>;

  return (
    <div>
      <p><Link to="/chief-admin">&larr; Back to Dashboard</Link></p>
      {readOnly && (
        <div className="readonly-banner">
          <span>View only - this client is assigned to you. Only an Admin can change client details, users, prices or access.</span>
          {/* Outside the disabled fieldset below, so it stays usable: MARKETING may open their assigned clients' app. */}
          <button type="button" onClick={handleLoginAsClient} disabled={loginAsBusy}>
            {loginAsBusy ? 'Opening…' : 'Log In as This Client'}
          </button>
        </div>
      )}
      <fieldset disabled={readOnly} className="readonly-fieldset">

      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
          <h3 style={{ margin: 0 }}>{readOnly ? 'Client' : 'Edit Client'} — {client.clientCode}</h3>
          {isAdmin && (
            <button type="button" onClick={handleLoginAsClient} disabled={loginAsBusy}>
              {loginAsBusy ? 'Opening…' : 'Log In as This Client'}
            </button>
          )}
        </div>
        <form onSubmit={handleSaveClient} className="form-grid" style={{ alignItems: 'end' }}>
          <label><span>Client Name</span><input value={form.clientName} onChange={(e) => setForm((f) => ({ ...f, clientName: e.target.value }))} required /></label>
          <label><span>Mobile</span><input value={form.mobile} onChange={(e) => setForm((f) => ({ ...f, mobile: e.target.value }))} /></label>
          <label><span>Email</span><input value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} /></label>
          <label><span>Address</span><input value={form.address} onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))} /></label>
          <div><span>Sales Person</span>
            <SearchSelect
              options={marketingPersons.map((m) => ({ value: m.username, label: `${m.name || m.username} (${m.username})` }))}
              value={form.salesPerson}
              onChange={(v) => setForm((f) => ({ ...f, salesPerson: v }))}
              placeholder="Search marketing person…"
            />
          </div>
          <label><span>Marketing Person Price (₹/month)</span>
            <input type="number" min={0} value={form.marketingPersonPrice} onChange={(e) => setForm((f) => ({ ...f, marketingPersonPrice: e.target.value }))} />
          </label>
          <label><span>Monthly Amount</span>
            <input
              value={`₹${calculatePlanAmount(billableUsers.length) + (Number(form.marketingPersonPrice) || 0)} (${billableUsers.length} user${billableUsers.length === 1 ? '' : 's'} + ₹${Number(form.marketingPersonPrice) || 0} marketing)`}
              disabled
            />
          </label>
          <label><span>Active</span>
            <select value={form.active ? 'yes' : 'no'} onChange={(e) => setForm((f) => ({ ...f, active: e.target.value === 'yes' }))}>
              <option value="yes">Active</option>
              <option value="no">Inactive</option>
            </select>
          </label>
          <label><span>Bill Cancellation & Refund</span>
            <select
              value={form.allowBillCancellationRefund ? 'yes' : 'no'}
              onChange={(e) => setForm((f) => ({ ...f, allowBillCancellationRefund: e.target.value === 'yes' }))}
            >
              <option value="no">Disabled</option>
              <option value="yes">Enabled</option>
            </select>
          </label>
          <label><span>QR / Online Payment</span>
            <select
              value={form.qrPaymentRequired ? 'yes' : 'no'}
              onChange={(e) => setForm((f) => ({ ...f, qrPaymentRequired: e.target.value === 'yes' }))}
            >
              <option value="yes">Required — client self-pays via QR</option>
              <option value="no">Not required — I'll record payments manually</option>
            </select>
          </label>
          <button type="submit">Save Changes</button>
        </form>
        {saveMessage && <p style={{ color: '#166534' }}>{saveMessage}</p>}
        {error && <p className="error-text">{error}</p>}
        <p>Current payment status: <span className={`badge ${client.paymentStatus}`}>{client.paymentStatus}</span></p>
        <p>Paid through: <strong>{client.paidThrough ? new Date(client.paidThrough).toLocaleDateString() : '—'}</strong></p>
      </div>

      <div className="card">
        <h3>Subscription History</h3>
        <table>
          <thead><tr><th>Month</th><th>From</th><th>To</th><th>Due</th><th>Amount</th><th>Status</th></tr></thead>
          <tbody>
            {subscriptions.map((s) => (
              <tr key={s.id}>
                <td>{s.month}</td><td>{s.fromDate}</td><td>{s.toDate}</td><td>{s.dueDate}</td>
                <td>₹{s.amount}</td><td><span className={`badge ${s.status}`}>{s.status}</span></td>
              </tr>
            ))}
            {subscriptions.length === 0 && <tr><td colSpan={6}>No subscription cycles yet.</td></tr>}
          </tbody>
        </table>

        {isAdmin && (<>
        <h4 style={{ marginTop: 18 }}>Record a Direct Payment</h4>
        <p style={{ fontSize: 13, color: '#64748b' }}>
          For a client that paid you directly (cash, bank transfer, etc.) instead of through the in-app QR/online
          checkout. Recording it here enables their access immediately - same as an online payment would.
        </p>
        <form onSubmit={handleRecordManualPayment} className="form-grid" style={{ alignItems: 'end' }}>
          <label><span>Months Covered</span>
            <input
              type="number" min="1" max="24"
              value={manualPaymentForm.months}
              onChange={(e) => setManualPaymentForm((f) => ({ ...f, months: e.target.value }))}
            />
          </label>
          <label><span>Payment Mode</span>
            <select value={manualPaymentForm.mode} onChange={(e) => setManualPaymentForm((f) => ({ ...f, mode: e.target.value }))}>
              <option>Cash</option><option>Bank Transfer</option><option>UPI</option><option>Cheque</option><option>Other</option>
            </select>
          </label>
          <label><span>Reference / Transaction ID (optional)</span>
            <input value={manualPaymentForm.transactionId} onChange={(e) => setManualPaymentForm((f) => ({ ...f, transactionId: e.target.value }))} />
          </label>
          <label><span>Remarks (optional)</span>
            <input value={manualPaymentForm.remarks} onChange={(e) => setManualPaymentForm((f) => ({ ...f, remarks: e.target.value }))} />
          </label>
          <button type="submit" disabled={manualPaymentSaving}>{manualPaymentSaving ? 'Recording…' : 'Record Payment'}</button>
        </form>
        {manualPaymentMessage && <p style={{ color: '#166534' }}>{manualPaymentMessage}</p>}
        {manualPaymentError && <p className="error-text">{manualPaymentError}</p>}

        <h4 style={{ marginTop: 18 }}>Grant Free Days</h4>
        <p style={{ fontSize: 13, color: '#64748b' }}>
          Give this client extra days of access at no charge - e.g. a goodwill extension. Added right after
          whatever they're currently paid through (or starting today if they've already lapsed); their following
          cycle bills normally again.
        </p>
        <form onSubmit={handleGrantFreeDays} className="form-grid" style={{ alignItems: 'end' }}>
          <label><span>Free Days</span>
            <input type="number" min="1" max="365" value={freeDays} onChange={(e) => setFreeDays(e.target.value)} />
          </label>
          <button type="submit" disabled={freeDaysSaving}>{freeDaysSaving ? 'Granting…' : 'Grant Free Days'}</button>
        </form>
        {freeDaysMessage && <p style={{ color: '#166534' }}>{freeDaysMessage}</p>}
        {freeDaysError && <p className="error-text">{freeDaysError}</p>}
        </>)}
      </div>

      {revenue && (
        <div className="card">
          <h3>Lab Billing Revenue</h3>
          <p style={{ fontSize: 13, color: '#64748b', marginTop: -8 }}>
            Money this client has collected from their own patients through the app - separate from the monthly
            subscription they pay you above.
          </p>
          <div className="stat-row">
            <div className="stat-tile"><div className="value">{revenue.totalBillCount}</div><div className="label">Total Bills</div></div>
            <div className="stat-tile"><div className="value">₹{revenue.totalRevenueCollected}</div><div className="label">Total Collected</div></div>
            <div className="stat-tile"><div className="value">₹{revenue.totalDiscountGiven}</div><div className="label">Total Discount Given</div></div>
            <div className="stat-tile"><div className="value">₹{revenue.totalDueOutstanding}</div><div className="label">Due Outstanding</div></div>
            <div className="stat-tile"><div className="value">{revenue.thisMonthBillCount}</div><div className="label">Bills This Month</div></div>
            <div className="stat-tile"><div className="value">₹{revenue.thisMonthRevenueCollected}</div><div className="label">Collected This Month</div></div>
          </div>
        </div>
      )}

      <div className="card">
        <h3>Locations</h3>
        <p style={{ fontSize: 13, color: '#64748b', marginTop: -8 }}>
          With more than one active location, the client's login screen asks for a Location after the Client Code.
          The first location is Main: its prices are the client's own prices, and other locations use them until the
          client sets their own under Masters &amp; Pricing → Price Updation.
        </p>
        <form onSubmit={handleAddLocation} className="form-grid" style={{ alignItems: 'end' }}>
          <label><span>Location Name</span><input value={newLocation.name} onChange={(e) => setNewLocation((f) => ({ ...f, name: e.target.value }))} placeholder="e.g. Ameerpet Branch" required /></label>
          <label><span>Address (optional)</span><input value={newLocation.address} onChange={(e) => setNewLocation((f) => ({ ...f, address: e.target.value }))} /></label>
          <button type="submit">Add Location</button>
        </form>
        {locationMessage && <p style={{ color: '#166534' }}>{locationMessage}</p>}
        {locationError && <p className="error-text">{locationError}</p>}
        <table>
          <thead><tr><th>Location</th><th>Address</th><th>Type</th><th>Status</th><th></th></tr></thead>
          <tbody>
            {locations.map((l) => {
              const edit = locationEdits[l.id];
              const value = edit ?? { name: l.name, address: l.address || '' };
              const setEdit = (changes) => setLocationEdits((all) => ({ ...all, [l.id]: { ...value, ...changes } }));
              return (
                <tr key={l.id}>
                  <td><input style={{ minWidth: 160 }} value={value.name} onChange={(e) => setEdit({ name: e.target.value })} /></td>
                  <td><input style={{ minWidth: 180 }} value={value.address} onChange={(e) => setEdit({ address: e.target.value })} /></td>
                  <td>{l.isMain ? <span className="badge PAID">Main</span> : 'Branch'}</td>
                  <td>{l.active ? 'Active' : 'Inactive'}</td>
                  <td><div style={{ display: 'flex', gap: 6 }}>
                    {edit && <button type="button" onClick={() => handleUpdateLocation(l.id, edit)}>Save</button>}
                    {!l.isMain && (
                      <button type="button" className="secondary" onClick={() => handleUpdateLocation(l.id, { active: !l.active })}>
                        {l.active ? 'Make Inactive' : 'Make Active'}
                      </button>
                    )}
                  </div></td>
                </tr>
              );
            })}
            {locations.length === 0 && <tr><td colSpan={5}>No locations yet - this client works as a single location.</td></tr>}
          </tbody>
        </table>
      </div>

      <div className="card">
        <h3>Users</h3>
        <form onSubmit={handleAddUser} className="form-grid" style={{ alignItems: 'end' }}>
          <label><span>Username</span><input value={newUser.username} onChange={(e) => setNewUser((f) => ({ ...f, username: e.target.value }))} required /></label>
          <label><span>Name</span><input value={newUser.name} onChange={(e) => setNewUser((f) => ({ ...f, name: e.target.value }))} /></label>
          <label><span>Password</span><input type="password" value={newUser.password} onChange={(e) => setNewUser((f) => ({ ...f, password: e.target.value }))} required /></label>
          <label><span>Department</span><input value={newUser.department} onChange={(e) => setNewUser((f) => ({ ...f, department: e.target.value }))} placeholder="e.g. Laboratory" /></label>
          <label><span>Designation</span><input value={newUser.designation} onChange={(e) => setNewUser((f) => ({ ...f, designation: e.target.value }))} placeholder="e.g. Lab Technician" /></label>
          {multiLocation && (
            <label><span>Location</span>
              <select value={newUser.locationId} onChange={(e) => setNewUser((f) => ({ ...f, locationId: e.target.value }))}>
                <option value="ALL">All locations</option>
                {activeLocations.map((l) => <option key={l.id} value={l.id}>{l.name} only</option>)}
              </select>
            </label>
          )}
          <div><span>Roles</span>
            <RoleCheckboxes value={newUser.roleNames} onChange={(roleNames) => setNewUser((f) => ({ ...f, roleNames }))} />
          </div>
          <button type="submit">Add User</button>
        </form>
        <table>
          <thead><tr><th>Username</th><th>Name</th><th>Department</th><th>Designation</th>{multiLocation && <th>Location</th>}<th>Signature</th><th>Roles</th><th>Active</th><th></th></tr></thead>
          <tbody>
            {users.map((u) => {
              const profile = profileForUser(u);
              const profileDirty = !!userProfileEdits[u.id];
              return (
                <tr key={u.id}>
                  <td>
                    {u.username}
                    {u.isSystemUser && <div><span className="badge PENDING" title="Auto-created for Chief Admin support login - not a billable staff user">System</span></div>}
                  </td>
                  <td>{u.name}</td>
                  <td>
                    <input
                      style={{ width: 120 }}
                      value={profile.department}
                      onChange={(e) => setUserProfileEdits((edits) => ({ ...edits, [u.id]: { ...profile, department: e.target.value } }))}
                    />
                  </td>
                  <td>
                    <input
                      style={{ width: 120 }}
                      value={profile.designation}
                      onChange={(e) => setUserProfileEdits((edits) => ({ ...edits, [u.id]: { ...profile, designation: e.target.value } }))}
                    />
                  </td>
                  {multiLocation && (
                    <td>
                      <select style={{ minWidth: 130 }} value={userLocationValue(u)} onChange={(e) => handleSetUserLocation(u.id, e.target.value)}>
                        <option value="ALL">All locations</option>
                        {activeLocations.map((l) => <option key={l.id} value={l.id}>{l.name} only</option>)}
                        {!u.allLocations && u.locationId && !activeLocations.some((l) => l.id === u.locationId) && (
                          <option value={u.locationId}>{locations.find((l) => l.id === u.locationId)?.name || 'Location'} (inactive)</option>
                        )}
                      </select>
                    </td>
                  )}
                  <td>
                    {u.signaturePath && <img src={u.signaturePath} alt="Signature" style={{ height: 24, display: 'block', marginBottom: 4 }} />}
                    <input
                      type="file" accept="image/*" style={{ width: 130, fontSize: 11 }}
                      disabled={signatureUploading === u.id}
                      onChange={(e) => handleUploadSignature(u.id, e.target.files[0])}
                    />
                  </td>
                  <td style={{ minWidth: 320 }}>
                    <RoleCheckboxes value={rolesForUser(u)} onChange={(roleNames) => setUserRoleEdits((edits) => ({ ...edits, [u.id]: roleNames }))} />
                  </td>
                  <td>{u.active ? 'Yes' : 'No'}</td>
                  <td style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 160 }}>
                    {userRoleEdits[u.id] && <button type="button" onClick={() => handleSaveUserRoles(u.id)}>Save Roles</button>}
                    {profileDirty && <button type="button" onClick={() => handleSaveUserProfile(u.id)}>Save Dept/Designation</button>}
                    {passwordResetFor === u.id ? (
                      <div style={{ display: 'flex', gap: 4 }}>
                        <input
                          type="password" placeholder="New password" style={{ width: 110 }}
                          value={newPassword} onChange={(e) => setNewPassword(e.target.value)}
                        />
                        <button type="button" disabled={passwordSaving} onClick={() => handleResetPassword(u.id)}>
                          {passwordSaving ? '…' : 'Save'}
                        </button>
                        <button type="button" className="secondary" onClick={() => { setPasswordResetFor(null); setNewPassword(''); }}>✕</button>
                      </div>
                    ) : (
                      <button type="button" className="secondary" onClick={() => { setPasswordResetFor(u.id); setNewPassword(''); }}>
                        Reset Password
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
            {users.length === 0 && <tr><td colSpan={multiLocation ? 9 : 8}>No users yet.</td></tr>}
          </tbody>
        </table>
      </div>

      {isAdmin && (
      <div className="card">
        <h3>Role → Screen Access</h3>
        <p style={{ fontSize: 13, color: '#64748b' }}>
          Which screens this client's FRONT_OFFICE / LAB_USER / MANAGER / MASTER_MANAGER staff can see. Tick or untick
          any screen - it saves straight away. Screens marked <span className="rs-default-dot" /> are in the platform default
          for that role. The client's own ADMIN always has full access and isn't listed.
        </p>
        {roleScreenError && <p className="error-text">{roleScreenError}</p>}
        {roleScreenMessage && <p style={{ color: '#166534' }}>{roleScreenMessage}</p>}
        <table>
          <thead>
            <tr>
              <th>Role</th>
              {SCREEN_CATALOG.map((s) => <th key={s.key}>{s.label}</th>)}
            </tr>
          </thead>
          <tbody>
            {roleScreenRoles.map((role) => (
              <tr key={role}>
                <td><strong>{role}</strong></td>
                {SCREEN_CATALOG.map((s) => {
                  const inDefault = (roleScreenDefaults[role] || []).includes(s.key);
                  return (
                    <td key={s.key}>
                      <label className="rs-cell" title={inDefault ? 'Part of the platform default for this role' : 'Extra screen granted to this client'}>
                        <input
                          type="checkbox"
                          style={{ width: 'auto' }}
                          checked={(roleScreenEffective[role] || []).includes(s.key)}
                          onChange={() => toggleRoleScreen(role, s.key)}
                        />
                        {inDefault && <span className="rs-default-dot" />}
                      </label>
                    </td>
                  );
                })}
              </tr>
            ))}
            {roleScreenRoles.length === 0 && <tr><td colSpan={SCREEN_CATALOG.length + 1}>Loading…</td></tr>}
          </tbody>
        </table>
      </div>
      )}

      <div className="card">
        <h3>Client-wise Test Pricing</h3>
        {locations.length > 1 && (
          <p style={{ fontSize: 13, color: '#64748b', marginTop: -8 }}>
            These are the Main location's prices. Other locations use them unless the client sets a location's own price.
          </p>
        )}
        <form onSubmit={handleSetPrice} className="form-grid" style={{ alignItems: 'end' }}>
          <label><span>Test</span>
            <select value={priceForm.testId} onChange={(e) => setPriceForm((f) => ({ ...f, testId: e.target.value }))} required>
              <option value="">Select test</option>
              {tests.map((t) => <option key={t.id} value={t.id}>{t.testCode} — {t.testName}</option>)}
            </select>
          </label>
          <label><span>Price (₹)</span><input type="number" value={priceForm.price} onChange={(e) => setPriceForm((f) => ({ ...f, price: e.target.value }))} required /></label>
          <button type="submit">Set Price</button>
        </form>
        <table>
          <thead><tr><th>Test Code</th><th>Test Name</th><th>Price</th></tr></thead>
          <tbody>
            {prices.map((p) => (
              <tr key={p.id}><td>{p.TestMaster?.testCode}</td><td>{p.TestMaster?.testName}</td><td>₹{p.price}</td></tr>
            ))}
            {prices.length === 0 && <tr><td colSpan={3}>No prices configured for this client yet.</td></tr>}
          </tbody>
        </table>
      </div>
      </fieldset>
    </div>
  );
}

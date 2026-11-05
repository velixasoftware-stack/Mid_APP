import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../../api/client';
import SearchSelect from '../../components/SearchSelect';
import { formatMoney } from '../../utils/format';

function thisMonthISO() {
  return new Date().toISOString().slice(0, 7);
}

/** ISO week string for today, e.g. "2026-W37" - what an <input type="week"> uses. */
function thisWeekISO() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + 3 - ((d.getDay() + 6) % 7)); // nearest Thursday, per ISO week rule
  const week1 = new Date(d.getFullYear(), 0, 4);
  const weekNum = 1 + Math.round(((d - week1) / 86400000 - 3 + ((week1.getDay() + 6) % 7)) / 7);
  return `${d.getFullYear()}-W${String(weekNum).padStart(2, '0')}`;
}

export default function PayorInvoices() {
  const [payors, setPayors] = useState([]);
  const [invoices, setInvoices] = useState([]);
  const [payorId, setPayorId] = useState('');
  const [month, setMonth] = useState(thisMonthISO());
  const [week, setWeek] = useState(thisWeekISO());
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [pending, setPending] = useState(null);

  const selectedPayor = payors.find((p) => String(p.id) === String(payorId));
  const isWeekly = selectedPayor?.billingCycle === 'WEEKLY';

  async function load() {
    const [payorsRes, invoicesRes] = await Promise.all([
      api.get('/payor-invoices/payors'),
      api.get('/payor-invoices'),
    ]);
    setPayors(payorsRes.data);
    setInvoices(invoicesRes.data);
  }
  useEffect(() => { load(); }, []);

  function loadPending(forPayorId) {
    if (!forPayorId) { setPending(null); return; }
    api.get('/payor-invoices/pending', { params: { payorId: forPayorId } }).then((r) => setPending(r.data));
  }
  useEffect(() => { loadPending(payorId); }, [payorId]);

  async function handleGenerate(e) {
    e.preventDefault();
    setError('');
    setMessage('');
    try {
      const payload = isWeekly ? { payorId: Number(payorId), week } : { payorId: Number(payorId), month };
      const { data } = await api.post('/payor-invoices/generate', payload);
      setMessage(`Invoice ${data.invoiceNo} generated for ${data.month}.`);
      load();
      loadPending(payorId);
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to generate invoice');
    }
  }

  return (
    <div>
      <div className="card">
        <h3>Generate Payor Invoice</h3>
        <p style={{ fontSize: 13, color: '#64748b' }}>
          Pulls together every test billed on credit under a payor's name during the chosen period that isn't
          on an invoice yet. A period can be invoiced more than once - bills added after an earlier invoice go on
          the next one; cancelled tests are left out. The period picker below (month or week) follows that payor's
          own billing cycle, set on the Payors screen.
        </p>
        <form onSubmit={handleGenerate} className="form-grid" style={{ alignItems: 'end' }}>
          <div><span>Payor</span>
            <SearchSelect
              options={payors.map((p) => ({ value: p.id, label: `${p.name} (${p.billingCycle === 'WEEKLY' ? 'Weekly' : 'Monthly'})` }))}
              value={payorId}
              onChange={setPayorId}
              placeholder="Search payor…"
            />
          </div>
          {isWeekly ? (
            <label><span>Week</span>
              <input type="week" value={week} onChange={(e) => setWeek(e.target.value)} required />
            </label>
          ) : (
            <label><span>Month</span>
              <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} required />
            </label>
          )}
          <button type="submit" disabled={!payorId}>Generate Invoice</button>
        </form>
        {error && <p className="error-text">{error}</p>}
        {message && <p style={{ color: '#166534' }}>{message}</p>}
      </div>

      {payorId && (
        <div className="card">
          <h3>Due Patients — {selectedPayor?.name}</h3>
          <p style={{ fontSize: 13, color: '#64748b' }}>
            Every patient billed to this credit client that hasn't been pulled into an invoice yet, across all
            time — not just the period picked above. These are the patients "Generate Invoice" will include once
            their bill falls inside the chosen period.
          </p>
          <table>
            <thead><tr><th>Bill No</th><th>Date</th><th>Patient</th><th>UMR</th><th>Test(s)</th><th>Amount</th></tr></thead>
            <tbody>
              {(pending?.pending || []).map((p) => (
                <tr key={p.billId}>
                  <td>{p.billNo}</td>
                  <td>{p.walkInDate}</td>
                  <td>{p.patientName}</td>
                  <td>{p.umr}</td>
                  <td>{p.tests}</td>
                  <td>₹{formatMoney(p.amount)}</td>
                </tr>
              ))}
              {pending && pending.pending.length === 0 && <tr><td colSpan={6}>No due patients — everything for this payor has already been invoiced.</td></tr>}
              {!pending && <tr><td colSpan={6}>Loading…</td></tr>}
            </tbody>
          </table>
          {pending && pending.pending.length > 0 && (
            <p style={{ marginTop: 10, fontWeight: 600 }}>Total Due: ₹{formatMoney(pending.total)} across {pending.count} patient bill{pending.count === 1 ? '' : 's'}</p>
          )}
        </div>
      )}

      <div className="card">
        <h3>Payor Invoices</h3>
        <table>
          <thead>
            <tr>
              <th>Invoice No</th><th>Payor</th><th>Period</th><th>Original</th><th>Assigned</th>
              <th>Collected</th><th>Deduction</th><th>Due</th><th>Status</th><th></th>
            </tr>
          </thead>
          <tbody>
            {invoices.map((inv) => (
              <tr key={inv.id}>
                <td>{inv.invoiceNo}</td>
                <td>{inv.Payor?.name}</td>
                <td>{inv.month}</td>
                <td>₹{formatMoney(inv.totalOriginal)}</td>
                <td>₹{formatMoney(inv.totalAssigned)}</td>
                <td>₹{formatMoney(inv.totalCollected)}</td>
                <td>₹{formatMoney(inv.totalDeduction)}</td>
                <td><strong>₹{formatMoney(inv.due)}</strong></td>
                <td><span className={`badge ${inv.status === 'COLLECTED' ? 'PAID' : (inv.status === 'PARTIALLY_COLLECTED' ? 'PENDING_COLLECTION' : 'PENDING')}`}>{inv.status.replace('_', ' ')}</span></td>
                <td style={{ display: 'flex', gap: 10 }}>
                  <Link to={`/app/payor-invoices/${inv.id}`}>View</Link>
                  <Link to={`/app/payor-invoices/${inv.id}?print=1`}>Print</Link>
                </td>
              </tr>
            ))}
            {invoices.length === 0 && <tr><td colSpan={10}>No invoices generated yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

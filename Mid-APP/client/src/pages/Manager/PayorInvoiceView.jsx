import { useEffect, useRef, useState } from 'react';
import { useParams, useSearchParams, Link } from 'react-router-dom';
import api from '../../api/client';
import { formatMoney } from '../../utils/format';

function blankCollection() {
  return { amount: '', paymentType: 'CASH', discount: '0', remarks: '' };
}

export default function PayorInvoiceView() {
  const { invoiceId } = useParams();
  const [searchParams] = useSearchParams();
  const [invoice, setInvoice] = useState(null);
  const [form, setForm] = useState(blankCollection());
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const hasAutoPrinted = useRef(false);

  async function load() {
    const { data } = await api.get(`/payor-invoices/${invoiceId}`);
    setInvoice(data);
  }
  useEffect(() => { load(); }, [invoiceId]);

  // Coming from the list's "Print" link (e.g. to hand this due-amount report
  // to the payor before any collection has happened) jumps straight to the
  // print dialog instead of requiring an extra click once the page loads.
  useEffect(() => {
    if (invoice && searchParams.get('print') === '1' && !hasAutoPrinted.current) {
      hasAutoPrinted.current = true;
      setTimeout(() => window.print(), 200);
    }
  }, [invoice, searchParams]);

  if (!invoice) return <p>Loading…</p>;

  const collections = invoice.PayorInvoiceCollections || [];
  const items = invoice.PayorInvoiceItems || [];
  const outstanding = Math.max(0, Number(invoice.totalAssigned) - Number(invoice.totalCollected) - Number(invoice.totalDeduction));

  // One row per bill/order (patient) - each test's detail line rolled up into
  // a subtotal, so the summary reads as "who owes what" while the detailed
  // table below still shows every individual test.
  const summaryMap = new Map();
  for (const item of items) {
    const key = item.billId ?? item.billNo ?? item.id;
    if (!summaryMap.has(key)) {
      summaryMap.set(key, {
        billId: item.billId,
        billNo: item.billNo || '—',
        patientName: item.patientName || '—',
        testCount: 0,
        totalOriginal: 0,
        totalAssigned: 0,
        totalDifference: 0,
      });
    }
    const row = summaryMap.get(key);
    row.testCount += 1;
    row.totalOriginal += Number(item.originalPrice);
    row.totalAssigned += Number(item.assignedPrice);
    row.totalDifference += Number(item.difference);
  }
  const summaryRows = Array.from(summaryMap.values());

  async function handleCollect(e) {
    e.preventDefault();
    setError('');
    setMessage('');
    const deduction = Number(form.discount) || 0;
    if (deduction > 0 && !form.remarks.trim()) {
      setError('Remarks are required when an Other Deduction amount is given.');
      return;
    }
    try {
      await api.post(`/payor-invoices/${invoiceId}/collections`, {
        amount: Number(form.amount), paymentType: form.paymentType,
        discount: deduction, remarks: form.remarks || undefined,
      });
      setForm(blankCollection());
      setMessage('Collection recorded.');
      load();
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to record collection');
    }
  }

  return (
    <div>
      <div className="no-print" style={{ marginBottom: 16, display: 'flex', gap: 16, alignItems: 'center' }}>
        <Link to="/app/payor-invoices">&larr; Back to Payor Invoices</Link>
        <button onClick={() => window.print()} style={{ marginLeft: 'auto' }}>Print / Save as PDF</button>
      </div>

      <div className="report-sheet">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', borderBottom: '2px solid #e2e8f0', paddingBottom: 16 }}>
          <div>
            <h2 style={{ margin: 0 }}>Payor Invoice</h2>
            <p style={{ margin: '4px 0 0', color: '#64748b', fontSize: 13 }}>{invoice.invoiceNo}</p>
          </div>
          <div style={{ textAlign: 'right' }}>
            <span className={`badge ${invoice.status === 'COLLECTED' ? 'PAID' : (invoice.status === 'PARTIALLY_COLLECTED' ? 'PENDING_COLLECTION' : 'PENDING')}`}>
              {invoice.status.replace('_', ' ')}
            </span>
          </div>
        </div>

        <div className="report-patient-grid">
          <div><span>Billed To</span><strong>{invoice.Payor?.name}</strong></div>
          <div><span>Contact Person</span><strong>{invoice.Payor?.contactPerson || '—'}</strong></div>
          <div><span>Mobile / Email</span><strong>{[invoice.Payor?.mobile, invoice.Payor?.email].filter(Boolean).join(' · ') || '—'}</strong></div>
          <div><span>Billing Period</span><strong>{invoice.fromDate} to {invoice.toDate}</strong></div>
          <div><span>Generated On</span><strong>{new Date(invoice.createdAt).toLocaleDateString()}</strong></div>
        </div>

        <h3 style={{ marginTop: 24 }}>Summary (by Patient / Order)</h3>
        <table>
          <thead>
            <tr><th>Patient Name</th><th>Order No</th><th>Tests</th><th className="no-print">Original Price</th><th>Assigned Price</th><th className="no-print">Difference</th></tr>
          </thead>
          <tbody>
            {summaryRows.map((row) => (
              <tr key={row.billId ?? row.billNo}>
                <td>{row.patientName}</td>
                <td>{row.billNo}</td>
                <td>{row.testCount}</td>
                <td className="no-print">₹{formatMoney(row.totalOriginal)}</td>
                <td>₹{formatMoney(row.totalAssigned)}</td>
                <td className="no-print" style={row.totalDifference > 0 ? { color: '#166534' } : undefined}>₹{formatMoney(row.totalDifference)}</td>
              </tr>
            ))}
            {summaryRows.length === 0 && <tr><td colSpan={6}>No line items.</td></tr>}
          </tbody>
        </table>

        <h3 style={{ marginTop: 24 }}>Detailed Line Items</h3>
        <table>
          <thead>
            <tr><th>Patient Name</th><th>Order No</th><th>Test</th><th className="no-print">Original Price</th><th>Assigned Price</th><th className="no-print">Difference</th></tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.id}>
                <td>{item.patientName || '—'}</td>
                <td>{item.billNo || '—'}</td>
                <td>{item.testName}</td>
                <td className="no-print">₹{formatMoney(item.originalPrice)}</td>
                <td>₹{formatMoney(item.assignedPrice)}</td>
                <td className="no-print" style={Number(item.difference) > 0 ? { color: '#166534' } : undefined}>₹{formatMoney(item.difference)}</td>
              </tr>
            ))}
            {items.length === 0 && <tr><td colSpan={6}>No line items.</td></tr>}
          </tbody>
        </table>

        <div className="pay-stat-row" style={{ marginTop: 16 }}>
          {/* Original prices are internal - shown on screen, never on the printed invoice. */}
          <div className="pay-stat-tile no-print"><div className="label">Original Total</div><div className="value">₹{formatMoney(invoice.totalOriginal)}</div></div>
          <div className="pay-stat-tile"><div className="label">Assigned Total</div><div className="value">₹{formatMoney(invoice.totalAssigned)}</div></div>
          <div className="pay-stat-tile"><div className="label">Collected</div><div className="value">₹{formatMoney(invoice.totalCollected)}</div></div>
          <div className="pay-stat-tile discount"><div className="label">Deduction</div><div className="value">₹{formatMoney(invoice.totalDeduction)}</div></div>
          <div className="pay-stat-tile net-payable"><div className="label">Amount Due</div><div className="value">₹{formatMoney(outstanding)}</div></div>
        </div>

        <h3 style={{ marginTop: 24 }}>Collections</h3>
        <table>
          <thead><tr><th>Date</th><th>Amount</th><th>Type</th><th>Other Deduction</th><th>Remarks</th></tr></thead>
          <tbody>
            {collections.map((c) => (
              <tr key={c.id}>
                <td>{new Date(c.collectedAt).toLocaleString()}</td>
                <td>₹{formatMoney(c.amount)}</td>
                <td>{c.paymentType}</td>
                <td>₹{formatMoney(c.discount)}</td>
                <td>{c.remarks || '—'}</td>
              </tr>
            ))}
            {collections.length === 0 && <tr><td colSpan={5}>No collections recorded yet.</td></tr>}
          </tbody>
        </table>

        <div className="no-print" style={{ marginTop: 16 }}>
          {outstanding > 0 ? (
            <>
              <h3 className="step-heading">Record Collection</h3>
              <form onSubmit={handleCollect} className="form-grid" style={{ alignItems: 'end' }}>
                <label><span>Amount (₹)</span>
                  <input type="number" min="0" step="0.01" value={form.amount} onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))} required />
                </label>
                <label><span>Payment Type</span>
                  <select value={form.paymentType} onChange={(e) => setForm((f) => ({ ...f, paymentType: e.target.value }))}>
                    <option value="CASH">Cash</option>
                    <option value="CARD">Card</option>
                    <option value="UPI">UPI</option>
                  </select>
                </label>
                <label><span>Other Deduction (₹)</span>
                  <input type="number" min="0" step="0.01" value={form.discount} onChange={(e) => setForm((f) => ({ ...f, discount: e.target.value }))} />
                </label>
                <label><span>Remarks{Number(form.discount) > 0 ? ' *' : ' (optional)'}</span>
                  <input
                    value={form.remarks}
                    onChange={(e) => setForm((f) => ({ ...f, remarks: e.target.value }))}
                    required={Number(form.discount) > 0}
                    placeholder={Number(form.discount) > 0 ? 'Required — reason for the deduction' : ''}
                  />
                </label>
                <button type="submit">Record Collection</button>
              </form>
            </>
          ) : (
            <p style={{ color: '#166534' }}>This invoice is fully collected — nothing due.</p>
          )}
          {error && <p className="error-text">{error}</p>}
          {message && <p style={{ color: '#166534' }}>{message}</p>}
        </div>
      </div>
    </div>
  );
}

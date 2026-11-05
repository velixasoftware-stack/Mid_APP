import { useEffect, useState } from 'react';
import api from '../../api/client';
import SearchSelect from '../../components/SearchSelect';
import { downloadFile } from '../../utils/download';

function blankPayor() {
  return { name: '', contactPerson: '', mobile: '', email: '', address: '', billingCycle: 'MONTHLY' };
}

export default function Payors() {
  const [tests, setTests] = useState([]);
  const [prices, setPrices] = useState([]);
  const [payors, setPayors] = useState([]);
  const [payorForm, setPayorForm] = useState(blankPayor());
  const [payorError, setPayorError] = useState('');
  const [selectedPayorId, setSelectedPayorId] = useState('');
  const [payorPrices, setPayorPrices] = useState([]);
  const [payorPriceForm, setPayorPriceForm] = useState({ testId: '', price: '' });

  const [bulkPreview, setBulkPreview] = useState(null);
  const [bulkFile, setBulkFile] = useState(null);
  const [bulkMessage, setBulkMessage] = useState('');

  async function loadAll() {
    const [testsRes, pricesRes, payorsRes] = await Promise.all([
      api.get('/masters/tests'),
      api.get('/masters/client-test-price'),
      api.get('/masters/payors'),
    ]);
    setTests(testsRes.data);
    setPrices(pricesRes.data);
    setPayors(payorsRes.data);
  }
  useEffect(() => { loadAll(); }, []);

  function reloadPayorPrices() {
    if (!selectedPayorId) return;
    api.get(`/masters/payors/${selectedPayorId}/test-prices`).then((r) => setPayorPrices(r.data));
  }

  useEffect(() => {
    setBulkPreview(null);
    setBulkFile(null);
    setBulkMessage('');
    if (!selectedPayorId) { setPayorPrices([]); return; }
    reloadPayorPrices();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedPayorId]);

  async function handleCreatePayor(e) {
    e.preventDefault();
    setPayorError('');
    try {
      await api.post('/masters/payors', payorForm);
      setPayorForm(blankPayor());
      loadAll();
    } catch (err) {
      setPayorError(err.response?.data?.message || 'Failed to create payor');
    }
  }

  async function handleSetPayorPrice(e) {
    e.preventDefault();
    await api.put(`/masters/payors/${selectedPayorId}/test-prices`, {
      testId: Number(payorPriceForm.testId), price: Number(payorPriceForm.price),
    });
    setPayorPriceForm({ testId: '', price: '' });
    reloadPayorPrices();
  }

  async function handleBulkPreview(e) {
    e.preventDefault();
    if (!bulkFile) return;
    setBulkMessage('');
    const formData = new FormData();
    formData.append('file', bulkFile);
    const { data } = await api.post(`/masters/payors/${selectedPayorId}/test-prices/upload/preview`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
    setBulkPreview(data);
  }

  async function handleBulkCommit() {
    const rows = bulkPreview.preview.filter((r) => r.valid).map((r) => ({ testCode: r.testCode, price: r.price }));
    const { data } = await api.post(`/masters/payors/${selectedPayorId}/test-prices/upload/commit`, { rows });
    setBulkMessage(`Uploaded: ${data.success.length} succeeded, ${data.errors.length} failed.`);
    setBulkPreview(null);
    setBulkFile(null);
    reloadPayorPrices();
  }

  return (
    <div>
      <div className="card">
        <h3>Payors</h3>
        <p style={{ fontSize: 13, color: '#64748b' }}>
          A Payor is a corporate, TPA or insurer billed for its patients' tests on credit, at its own negotiated
          prices, instead of the patient paying at the counter. Once added here, it shows up as the "Credit"
          billing type on the Patient &amp; Billing screen, and is invoiced on the cycle chosen below.
        </p>
        <form onSubmit={handleCreatePayor} className="form-grid" style={{ alignItems: 'end' }}>
          <label><span>Payor Name</span><input value={payorForm.name} onChange={(e) => setPayorForm((f) => ({ ...f, name: e.target.value }))} required /></label>
          <label><span>Contact Person</span><input value={payorForm.contactPerson} onChange={(e) => setPayorForm((f) => ({ ...f, contactPerson: e.target.value }))} /></label>
          <label><span>Mobile</span><input value={payorForm.mobile} onChange={(e) => setPayorForm((f) => ({ ...f, mobile: e.target.value }))} /></label>
          <label><span>Email</span><input value={payorForm.email} onChange={(e) => setPayorForm((f) => ({ ...f, email: e.target.value }))} /></label>
          <label><span>Address</span><input value={payorForm.address} onChange={(e) => setPayorForm((f) => ({ ...f, address: e.target.value }))} /></label>
          <label><span>Billing Cycle</span>
            <select value={payorForm.billingCycle} onChange={(e) => setPayorForm((f) => ({ ...f, billingCycle: e.target.value }))}>
              <option value="MONTHLY">Monthly</option>
              <option value="WEEKLY">Weekly</option>
            </select>
          </label>
          <button type="submit">Add Payor</button>
        </form>
        {payorError && <p className="error-text">{payorError}</p>}
        <table>
          <thead><tr><th>Name</th><th>Contact Person</th><th>Mobile</th><th>Email</th><th>Billing Cycle</th></tr></thead>
          <tbody>
            {payors.map((p) => (
              <tr key={p.id}>
                <td>{p.name}</td><td>{p.contactPerson || '—'}</td><td>{p.mobile || '—'}</td><td>{p.email || '—'}</td>
                <td>{p.billingCycle === 'WEEKLY' ? 'Weekly' : 'Monthly'}</td>
              </tr>
            ))}
            {payors.length === 0 && <tr><td colSpan={5}>No payors added yet.</td></tr>}
          </tbody>
        </table>
      </div>

      <div className="card">
        <h3>Payor Test Pricing</h3>
        <p style={{ fontSize: 13, color: '#64748b' }}>
          Pick a payor, then set its negotiated price per test. A test with no price set here is billed to that
          payor at the client's standard price.
        </p>
        <div style={{ maxWidth: 340, marginBottom: 14 }}>
          <span style={{ display: 'block', marginBottom: 6, fontWeight: 600, fontSize: 13 }}>Payor</span>
          <SearchSelect
            options={payors.map((p) => ({ value: p.id, label: p.name }))}
            value={selectedPayorId}
            onChange={setSelectedPayorId}
            placeholder="Search payor…"
          />
        </div>

        {selectedPayorId && (
          <>
            <form onSubmit={handleSetPayorPrice} className="form-grid" style={{ alignItems: 'end' }}>
              <div><span>Test</span>
                <SearchSelect
                  options={tests.map((t) => ({ value: t.id, label: `${t.testCode} — ${t.testName}` }))}
                  value={payorPriceForm.testId}
                  onChange={(testId) => setPayorPriceForm((f) => ({ ...f, testId }))}
                  placeholder="Search by test code or name…"
                />
              </div>
              <label><span>Payor Price (₹)</span><input type="number" value={payorPriceForm.price} onChange={(e) => setPayorPriceForm((f) => ({ ...f, price: e.target.value }))} required /></label>
              <button type="submit" disabled={!payorPriceForm.testId}>Set Price</button>
            </form>
            <table>
              <thead><tr><th>Test Code</th><th>Test Name</th><th>Standard Price</th><th>Payor Price</th></tr></thead>
              <tbody>
                {payorPrices.map((p) => {
                  const standard = prices.find((sp) => sp.testId === p.testId);
                  return (
                    <tr key={p.id}>
                      <td>{p.TestMaster?.testCode}</td>
                      <td>{p.TestMaster?.testName}</td>
                      <td>{standard ? `₹${standard.price}` : '—'}</td>
                      <td>₹{p.price}</td>
                    </tr>
                  );
                })}
                {payorPrices.length === 0 && <tr><td colSpan={4}>No payor-specific prices set — every test bills at the standard price.</td></tr>}
              </tbody>
            </table>
          </>
        )}
      </div>

      {selectedPayorId && (
        <div className="card">
          <h3>Bulk Update — Payor Test Prices</h3>
          <p style={{ fontSize: 13, color: '#64748b' }}>
            Columns: TEST_CODE, TEST_NAME, PRICE. The template downloads pre-filled with this payor's current
            prices — leave PRICE blank for a test to keep it billing at the client's standard price.
          </p>
          <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
            <button
              type="button"
              className="secondary"
              onClick={() => downloadFile(`/masters/payors/${selectedPayorId}/test-prices/template`, 'payor-test-price-template.xlsx')}
            >
              Download Template
            </button>
          </div>
          <form onSubmit={handleBulkPreview} className="form-grid" style={{ alignItems: 'end' }}>
            <input type="file" accept=".xlsx,.xls,.csv" onChange={(e) => setBulkFile(e.target.files[0])} />
            <button type="submit" disabled={!bulkFile}>Preview</button>
          </form>

          {bulkPreview && (
            <>
              <p>{bulkPreview.validRows} valid, {bulkPreview.invalidRows} invalid of {bulkPreview.totalRows} rows.</p>
              <table>
                <thead><tr><th>Row</th><th>Test Code</th><th>Price</th><th>Status</th></tr></thead>
                <tbody>
                  {bulkPreview.preview.map((r) => (
                    <tr key={r.row}>
                      <td>{r.row}</td><td>{r.testCode}</td><td>{r.price}</td>
                      <td>{r.valid ? <span className="badge PAID">Valid</span> : <span className="badge EXPIRED">{r.errors.join('; ')}</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <button onClick={handleBulkCommit} disabled={bulkPreview.validRows === 0} style={{ marginTop: 12 }}>
                Upload {bulkPreview.validRows} Valid Rows
              </button>
            </>
          )}
          {bulkMessage && <p>{bulkMessage}</p>}
        </div>
      )}
    </div>
  );
}

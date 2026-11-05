import { useEffect, useRef, useState } from 'react';
import api from '../../api/client';
import SearchSelect from '../../components/SearchSelect';
import BillReceiptSheet from '../../components/BillReceiptSheet';
import ShareButton from '../../components/ShareButton';
import ReferralDoctorPicker from '../../components/ReferralDoctorPicker';
import PatientTitleSelect from '../../components/PatientTitleSelect';

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function blankPatientForm() {
  return { title: '', name: '', age: '', ageUnit: 'Years', gender: 'Male', mobile: '', email: '', address: '' };
}

function IconSearch() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" />
    </svg>
  );
}

export default function FrontDesk() {
  const [prices, setPrices] = useState([]);
  const [payors, setPayors] = useState([]);
  const [payorId, setPayorId] = useState('');
  const [payorPrices, setPayorPrices] = useState([]);

  const [searchValue, setSearchValue] = useState('');
  const [patient, setPatient] = useState(null); // found existing patient
  const [patientForm, setPatientForm] = useState(blankPatientForm());
  const [searchMessage, setSearchMessage] = useState('');

  const [selectedTests, setSelectedTests] = useState([]);
  const [packages, setPackages] = useState([]);
  const [selectedPackages, setSelectedPackages] = useState([]); // package ids - each bills all its tests at the package price
  const [barcodes, setBarcodes] = useState({}); // { [testId]: barcode } - optional, per test
  const [testQuery, setTestQuery] = useState('');
  const [showTestResults, setShowTestResults] = useState(false);
  const testBoxRef = useRef(null);

  const [billingType, setBillingType] = useState('DIRECT'); // DIRECT | PAYOR
  const [doctorName, setDoctorName] = useState('');
  const [walkInDate, setWalkInDate] = useState(todayISO());
  const [visitType, setVisitType] = useState('WALK-IN');
  const [priority, setPriority] = useState('ROUTINE');
  const [discount, setDiscount] = useState('0');
  const [gstPercent, setGstPercent] = useState('0');
  const [hasDue, setHasDue] = useState(false); // patient pays only part now, rest recovered later
  const [amountCollected, setAmountCollected] = useState('');
  const [paymentMode, setPaymentMode] = useState('');
  const [visitAddress, setVisitAddress] = useState('');
  const [transactionNumber, setTransactionNumber] = useState('');
  const [remarks, setRemarks] = useState('');
  const isCredit = billingType === 'PAYOR';
  const needsTransactionNumber = !isCredit && (paymentMode === 'Card' || paymentMode === 'UPI');
  const discountGiven = (Number(discount) || 0) > 0;

  const [bill, setBill] = useState(null);
  const [error, setError] = useState('');
  const [generating, setGenerating] = useState(false);

  useEffect(() => {
    api.get('/billing/test-prices').then((r) => setPrices(r.data));
    api.get('/billing/packages').then((r) => setPackages(r.data)).catch(() => setPackages([]));
    api.get('/billing/payors').then((r) => setPayors(r.data));
    api.get('/billing-settings').then((r) => setGstPercent(String(r.data.defaultGstPercent ?? 0)));
  }, []);

  useEffect(() => {
    if (!payorId) { setPayorPrices([]); return; }
    api.get(`/billing/payors/${payorId}/test-prices`).then((r) => setPayorPrices(r.data));
  }, [payorId]);

  function effectivePrice(p) {
    if (!payorId) return Number(p.price);
    const override = payorPrices.find((pp) => pp.testId === p.testId);
    return override ? Number(override.price) : Number(p.price);
  }

  useEffect(() => {
    function handleClickOutside(e) {
      if (testBoxRef.current && !testBoxRef.current.contains(e.target)) setShowTestResults(false);
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  async function handleSearch(e) {
    e.preventDefault();
    setError('');
    setSearchMessage('');
    if (!searchValue.trim()) return;
    const isUmr = /^umr/i.test(searchValue.trim());
    const params = isUmr ? { umr: searchValue.trim() } : { mobile: searchValue.trim() };
    try {
      const { data } = await api.get('/patients/lookup', { params });
      setPatient(data);
      setPatientForm({ title: data.title || '', name: data.name, age: data.age || '', ageUnit: data.ageUnit || 'Years', gender: data.gender || 'Male', mobile: data.mobile || '', email: data.email || '', address: data.address || '' });
      setVisitAddress(data.address || '');
      setSearchMessage(`Existing patient found — ${data.umr}`);
    } catch (err) {
      setPatient(null);
      setPatientForm({ ...blankPatientForm(), mobile: isUmr ? '' : searchValue.trim().replace(/\D/g, '').slice(0, 10) });
      setSearchMessage('No existing patient found — enter details below to register.');
    }
  }

  function resetPatient() {
    setPatient(null);
    setPatientForm(blankPatientForm());
    setSearchValue('');
    setSearchMessage('');
  }

  function handleBillingTypeChange(type) {
    setBillingType(type);
    if (type !== 'PAYOR') setPayorId('');
    else { setPaymentMode(''); setTransactionNumber(''); }
  }

  function addTest(testId) {
    setSelectedTests((prev) => [...prev, testId]);
    setTestQuery('');
    setShowTestResults(false);
  }
  // A test can be on a bill only once - not on its own and in a package too.
  function addPackage(pkg) {
    const taken = new Map(selectedTests.map((id) => [id, 'already added on its own']));
    for (const pid of selectedPackages) {
      const other = packages.find((x) => x.id === pid);
      for (const t of other?.TestMasters || []) taken.set(t.id, `already in package ${other.packageName}`);
    }
    const clash = (pkg.TestMasters || []).find((t) => taken.has(t.id));
    setTestQuery('');
    setShowTestResults(false);
    if (clash) {
      setError(`${pkg.packageName} can't be added: ${clash.testName} is ${taken.get(clash.id)}.`);
      return;
    }
    setError('');
    setSelectedPackages((prev) => [...prev, pkg.id]);
  }
  function removePackage(id) {
    setSelectedPackages((prev) => prev.filter((x) => x !== id));
    const pkg = packages.find((x) => x.id === id);
    setBarcodes((prev) => {
      const next = { ...prev };
      for (const t of pkg?.TestMasters || []) delete next[t.id];
      return next;
    });
  }
  function removeTest(testId) {
    setSelectedTests((prev) => prev.filter((id) => id !== testId));
    setBarcodes((prev) => { const next = { ...prev }; delete next[testId]; return next; });
  }
  function setBarcode(testId, value) {
    setBarcodes((prev) => ({ ...prev, [testId]: value }));
  }

  const selectedPrices = prices.filter((p) => selectedTests.includes(p.testId));
  const packagedTestIds = new Set(packages
    .filter((pkg) => selectedPackages.includes(pkg.id))
    .flatMap((pkg) => pkg.TestMasters.map((t) => t.id)));
  const availablePrices = prices.filter((p) => !selectedTests.includes(p.testId) && !packagedTestIds.has(p.testId));
  const testQueryLower = testQuery.toLowerCase();
  const testSuggestions = availablePrices.filter((p) => (
    p.TestMaster?.testName?.toLowerCase().includes(testQueryLower)
    || p.TestMaster?.testCode?.toLowerCase().includes(testQueryLower)
    || p.shortName?.toLowerCase().includes(testQueryLower)
  ));

  const chosenPackages = packages.filter((pkg) => selectedPackages.includes(pkg.id));
  const packageSuggestions = packages.filter((pkg) => !selectedPackages.includes(pkg.id) && (
    pkg.packageName.toLowerCase().includes(testQueryLower) || pkg.packageCode.toLowerCase().includes(testQueryLower)
  ));
  const hasItems = selectedTests.length > 0 || selectedPackages.length > 0;

  const gross = selectedPrices.reduce((s, p) => s + effectivePrice(p), 0)
    + chosenPackages.reduce((s, pkg) => s + Number(pkg.price), 0);
  const taxableAmount = Math.max(0, gross - (Number(discount) || 0));
  const taxAmount = Math.round(taxableAmount * (Number(gstPercent) || 0)) / 100;
  const cgstAmount = Math.round(taxAmount * 50) / 100;
  const sgstAmount = Math.round((taxAmount - cgstAmount) * 100) / 100;
  const netPayable = taxableAmount + taxAmount;
  // Each line's amount after its share of the discount (and GST), split by
  // price exactly as the bill/receipt does (server utils/billCharges.js) -
  // shown beside the price as "₹50 → ₹43.75". The last line takes the
  // paise rounding so the lines add up to Net Payable.
  const showNet = gross > 0 && Math.abs(netPayable - gross) > 0.001;
  const netByLine = (() => {
    const lines = [
      ...chosenPackages.map((pkg) => [`pkg-${pkg.id}`, Number(pkg.price)]),
      ...selectedPrices.map((p) => [`t-${p.testId}`, effectivePrice(p)]),
    ];
    const out = {};
    let allocated = 0;
    lines.forEach(([key, price], i) => {
      const share = i === lines.length - 1
        ? Math.round((netPayable - allocated) * 100) / 100
        : Math.round((gross > 0 ? netPayable * price / gross : 0) * 100) / 100;
      allocated = Math.round((allocated + share) * 100) / 100;
      out[key] = share;
    });
    return out;
  })();
  const priceCell = (price, key) => (showNet
    ? <span className="fd-price-net" title="Price → after its share of the discount/GST"><s>₹{price}</s> → <strong>₹{netByLine[key].toFixed(2)}</strong></span>
    : <>₹{price}</>);
  // Full amount by default (unchanged behaviour); "record a due balance" lets
  // less than netPayable be collected now, the rest recovered later from
  // Orders. Doesn't apply to credit billing - a payor bill is never "due"
  // from the patient, it's invoiced to the payor on their own cycle.
  const collectingNow = (!isCredit && hasDue) ? Math.min(netPayable, Math.max(0, Number(amountCollected) || 0)) : netPayable;
  const dueNow = (!isCredit && hasDue) ? Math.max(0, netPayable - collectingNow) : 0;

  async function handleGenerateBill(e) {
    e.preventDefault();
    if (generating) return;
    setError('');
    if (!isCredit && collectingNow > 0 && !paymentMode) {
      setError('Payment Mode is required.');
      return;
    }
    if (isCredit && !payorId) {
      setError('Please select a payor for credit billing.');
      return;
    }
    if (discountGiven && !remarks.trim()) {
      setError('Remarks are required when a discount is given.');
      return;
    }
    if (needsTransactionNumber && !transactionNumber.trim()) {
      setError(`Payment Transaction Number is required for ${paymentMode} payments.`);
      return;
    }
    setGenerating(true);
    try {
      const payload = {
        testIds: selectedTests,
        packageIds: selectedPackages,
        referredDoctorName: doctorName.trim() || undefined,
        walkInDate,
        visitType,
        priority,
        discount: Number(discount) || 0,
        gstPercent: Number(gstPercent) || 0,
        paymentMode: isCredit ? undefined : paymentMode,
        visitAddress,
        transactionNumber: needsTransactionNumber ? transactionNumber : undefined,
        remarks,
        payorId: payorId || undefined,
        amountCollected: (!isCredit && hasDue) ? collectingNow : undefined,
        barcodes: Object.fromEntries(Object.entries(barcodes).filter(([, v]) => v?.trim())),
      };
      if (patient) {
        payload.patientId = patient.id;
      } else {
        if (!patientForm.name) throw { response: { data: { message: 'Patient name is required' } } };
        if (patientForm.age === '' || patientForm.age == null || Number.isNaN(Number(patientForm.age)) || Number(patientForm.age) < 0) {
          throw { response: { data: { message: 'Patient age is required' } } };
        }
        Object.assign(payload, patientForm, { age: patientForm.age ? Number(patientForm.age) : null });
      }

      const { data } = await api.post('/billing/bills', payload);
      const { data: full } = await api.get(`/billing/bills/${data.id}`);
      setBill(full);
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to generate bill');
    } finally {
      setGenerating(false);
    }
  }

  function startNewBill() {
    setBill(null);
    resetPatient();
    setSelectedTests([]);
    setSelectedPackages([]);
    setBarcodes({});
    setBillingType('DIRECT');
    setDoctorName('');
    setPayorId('');
    setDiscount('0');
    api.get('/billing-settings').then((r) => setGstPercent(String(r.data.defaultGstPercent ?? 0)));
    setHasDue(false);
    setAmountCollected('');
    setPaymentMode('');
    setVisitAddress('');
    setTransactionNumber('');
    setRemarks('');
    setWalkInDate(todayISO());
  }

  if (bill) {
    return (
      <div>
        <div className="no-print" style={{ marginBottom: 16, display: 'flex', gap: 8 }}>
          <button onClick={() => window.print()}>Print Bill</button>
          <ShareButton apiPath={`/billing/bills/${bill.id}/share`} />
          <button className="secondary" onClick={startNewBill}>New Bill</button>
        </div>
        <BillReceiptSheet bill={bill} />
      </div>
    );
  }

  return (
    <div className="front-desk">
      <div className="card">
        <h3 className="step-heading">1. Patient Details <span className="step-hint">— search an existing patient or register a new one</span></h3>
        {/* Billing type, credit client (if any) and patient search share one row
            so the whole billing screen fits without scrolling. */}
        <form onSubmit={handleSearch} className="fd-top-row">
          <div className="fd-field">
            <span>Billing Type</span>
            <div className="segmented-toggle">
              <button type="button" className={billingType === 'DIRECT' ? 'active' : ''} onClick={() => handleBillingTypeChange('DIRECT')} title="The patient pays at the counter, at the client's standard test prices">Direct</button>
              <button type="button" className={billingType === 'PAYOR' ? 'active' : ''} onClick={() => handleBillingTypeChange('PAYOR')} title="Priced at the credit client's negotiated rate and invoiced to them on their billing cycle">Credit</button>
            </div>
          </div>
          {billingType === 'PAYOR' && (
            <div className="fd-field fd-grow">
              <span>Credit Client (corporate / TPA / insurer)</span>
              <SearchSelect
                options={payors.map((p) => ({ value: p.id, label: `${p.name} (${p.billingCycle === 'WEEKLY' ? 'Weekly' : 'Monthly'} billing)` }))}
                value={payorId}
                onChange={setPayorId}
                placeholder="Search credit client…"
              />
            </div>
          )}
          <label className="fd-grow"><span>Search by UMR or Mobile</span>
            <input
              value={searchValue}
              onChange={(e) => {
                const v = e.target.value;
                // Numeric input is a mobile number: digits only, max 10. Anything else (UMR) is left as typed.
                if (!/^[\d\s+-]*$/.test(v)) return setSearchValue(v);
                let digits = v.replace(/\D/g, '');
                if (digits.length === 12 && digits.startsWith('91')) digits = digits.slice(2); // pasted +91 number
                setSearchValue(digits.slice(0, 10));
              }}
              placeholder="UMR000012 or 98765xxxxx"
            />
          </label>
          <button type="submit" className="fd-search-btn">Search</button>
          {(patient || searchMessage) && <button type="button" className="secondary fd-search-btn" onClick={resetPatient}>Clear</button>}
        </form>
        {searchMessage && <p className="fd-search-msg" style={{ color: patient ? '#166534' : '#854d0e' }}>{searchMessage}</p>}

        <div className="form-grid fd-patient-grid">
          <label><span>Mobile No *</span>
            <input
              value={patientForm.mobile}
              onChange={(e) => setPatientForm((f) => ({ ...f, mobile: e.target.value.replace(/\D/g, '').slice(0, 10) }))}
              disabled={!!patient}
              inputMode="numeric"
              maxLength={10}
              required
            />
          </label>
          <label className="fd-title-field"><span>Title</span>
            <PatientTitleSelect
              value={patientForm.title}
              onChange={(title, gender) => setPatientForm((f) => ({ ...f, title, ...(gender ? { gender } : {}) }))}
              disabled={!!patient}
            />
          </label>
          <label className="fd-name-field"><span>Patient Name *</span>
            <input value={patientForm.name} onChange={(e) => setPatientForm((f) => ({ ...f, name: e.target.value }))} disabled={!!patient} required />
          </label>
          <label><span>Gender</span>
            <select value={patientForm.gender} onChange={(e) => setPatientForm((f) => ({ ...f, gender: e.target.value }))} disabled={!!patient}>
              <option>Male</option><option>Female</option><option>Other</option>
            </select>
          </label>
          <label><span>Age *</span>
            <div style={{ display: 'flex', gap: 6 }}>
              <input type="number" min="0" required={!patient} style={{ flex: 1 }} value={patientForm.age} onChange={(e) => setPatientForm((f) => ({ ...f, age: e.target.value }))} disabled={!!patient} />
              <select style={{ flex: 1 }} value={patientForm.ageUnit} onChange={(e) => setPatientForm((f) => ({ ...f, ageUnit: e.target.value }))} disabled={!!patient}>
                <option>Years</option><option>Months</option><option>Days</option>
              </select>
            </div>
          </label>
          <label><span>Email (optional)</span>
            <input value={patientForm.email} onChange={(e) => setPatientForm((f) => ({ ...f, email: e.target.value }))} disabled={!!patient} />
          </label>
          {patient && <label><span>UMR No</span><input value={patient.umr} disabled /></label>}
          <label><span>Walk-in On</span>
            <input type="date" value={walkInDate} onChange={(e) => setWalkInDate(e.target.value)} />
          </label>
          <label><span>Visit Type</span>
            <select value={visitType} onChange={(e) => setVisitType(e.target.value)}>
              <option value="WALK-IN">Walk-in</option>
              <option value="OPD">OPD</option>
              <option value="IPD">IPD</option>
            </select>
          </label>
          <label><span>Priority</span>
            <select value={priority} onChange={(e) => setPriority(e.target.value)}>
              <option value="ROUTINE">Routine</option>
              <option value="URGENT">Urgent</option>
            </select>
          </label>
          {/* Optional - works with Direct and Credit billing alike; it only records who referred the patient. */}
          <ReferralDoctorPicker value={doctorName} onChange={setDoctorName} />
        </div>
      </div>

      {/* Bill items and payment side by side on wide screens (stacked on narrow ones). */}
      <div className="fd-columns">
      <div className="card">
        <h3 className="step-heading">2. Bill Items <span className="step-hint">— add at least 1 item</span></h3>

        <div className="bill-items-box" ref={testBoxRef}>
          <div className="bill-items-search">
            <IconSearch />
            <input
              placeholder="Search & tap a test or package to add…"
              value={testQuery}
              onChange={(e) => { setTestQuery(e.target.value); setShowTestResults(true); }}
              onFocus={() => setShowTestResults(true)}
            />
            {showTestResults && (
              <div className="search-select-results" style={{ position: 'absolute', top: '100%', marginTop: 4 }}>
                {packageSuggestions.slice(0, 15).map((pkg) => (
                  <div key={`pkg-${pkg.id}`} className="search-select-item" onClick={() => addPackage(pkg)}>
                    <span className="badge COLLECTED" style={{ marginRight: 6 }}>PACKAGE</span>
                    {pkg.packageName}
                    <span style={{ color: '#64748b' }}> · ₹{Number(pkg.price)} · {pkg.TestMasters.length} test(s)</span>
                  </div>
                ))}
                {testSuggestions.slice(0, 30).map((p) => (
                  <div key={p.id} className="search-select-item" onClick={() => addTest(p.testId)}>
                    {p.TestMaster?.testName}
                    {p.shortName && <span style={{ color: '#94a3b8' }}> ({p.shortName})</span>}
                    <span style={{ color: '#64748b' }}> · ₹{effectivePrice(p)}</span>
                  </div>
                ))}
                {testSuggestions.length === 0 && packageSuggestions.length === 0 && <div className="search-select-item search-select-empty">No matching tests or packages</div>}
              </div>
            )}
          </div>

          {(selectedPrices.length > 0 || chosenPackages.length > 0) && (
            <div className="selected-items-list">
              {/* The package is billed as one line at its own price; each test it
                  includes goes to the lab as its own sample, so each gets a barcode box. */}
              {chosenPackages.map((pkg) => (
                <div key={`pkg-${pkg.id}`}>
                  <div className="selected-item-row">
                    <span>
                      <span className="badge COLLECTED" style={{ marginRight: 6 }}>PACKAGE</span>
                      <strong>{pkg.packageName}</strong>
                      <span style={{ color: '#64748b', fontSize: 12 }}> · {pkg.TestMasters.length} test(s) included</span>
                    </span>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      {priceCell(Number(pkg.price), `pkg-${pkg.id}`)}
                      <button type="button" onClick={() => removePackage(pkg.id)}>Remove</button>
                    </span>
                  </div>
                  {pkg.TestMasters.map((t) => (
                    <div className="selected-item-row" key={`pkg-${pkg.id}-t-${t.id}`} style={{ paddingLeft: 28, background: '#f8fafc' }}>
                      <span style={{ fontSize: 13 }}>↳ {t.testName}</span>
                      <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <input
                          value={barcodes[t.id] || ''}
                          onChange={(e) => setBarcode(t.id, e.target.value)}
                          placeholder="Barcode (optional, scan or type)"
                          style={{ width: 190 }}
                        />
                        <span style={{ fontSize: 12, color: '#94a3b8', minWidth: 70 }}>In package</span>
                      </span>
                    </div>
                  ))}
                </div>
              ))}
              {selectedPrices.map((p) => (
                <div className="selected-item-row" key={p.id}>
                  <span>{p.TestMaster?.testName}</span>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <input
                      value={barcodes[p.testId] || ''}
                      onChange={(e) => setBarcode(p.testId, e.target.value)}
                      placeholder="Barcode (optional, scan or type)"
                      style={{ width: 190 }}
                    />
                    {priceCell(effectivePrice(p), `t-${p.testId}`)}
                    <button type="button" onClick={() => removeTest(p.testId)}>Remove</button>
                  </span>
                </div>
              ))}
            </div>
          )}
          {hasItems && (
            <p style={{ fontSize: 11.5, color: '#94a3b8', margin: '6px 0 0' }}
              title='If you scan/enter a barcode now, that test skips straight to result entry (no separate "Collect Sample" step in the Lab screen).'>
              Barcode optional — blank = auto-assigned; scanned now = ready for result entry.
            </p>
          )}
        </div>

      </div>

      <div className="card">
        <h3 className="step-heading">3. Payment</h3>

        {/* Totals sit at the top of Payment, right above how it's being paid. */}
        <div className="pay-stat-row">
          <div className="pay-stat-tile"><div className="label">Gross</div><div className="value">₹{gross}</div></div>
          <div className="pay-stat-tile discount">
            <div className="label">Discount</div>
            <input type="number" min={0} value={discount} onChange={(e) => setDiscount(e.target.value)} style={{ textAlign: 'center' }} />
          </div>
          <div className="pay-stat-tile discount">
            <div className="label">GST %</div>
            <input type="number" min={0} max={100} step="0.01" value={gstPercent} onChange={(e) => setGstPercent(e.target.value)} style={{ textAlign: 'center' }} />
          </div>
          <div className="pay-stat-tile net-payable"><div className="label">Net Payable</div><div className="value">₹{netPayable}</div></div>
        </div>

        {/* Patient / items / net payable are already shown above (Net Payable tile) -
            only the GST split is shown here, and only when the bill carries GST. */}
        {taxAmount > 0 && (
          <div className="review-box">
            <div className="review-box-row"><span>Taxable Amount</span><span>₹{taxableAmount}</span></div>
            <div className="review-box-row"><span>CGST ({(Number(gstPercent) || 0) / 2}%)</span><span>₹{cgstAmount}</span></div>
            <div className="review-box-row"><span>SGST ({(Number(gstPercent) || 0) / 2}%)</span><span>₹{sgstAmount}</span></div>
          </div>
        )}

        {isCredit && (
          <p style={{ fontSize: 12, color: '#94a3b8', marginTop: 0, marginBottom: 10 }}>
            Credit bill — charged to the credit client and settled later; no payment mode needed.
          </p>
        )}

        {!isCredit && netPayable > 0 && (
          <div style={{ marginBottom: 10 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 500 }} title='Leave a due balance, recovered later from Orders'>
              <input type="checkbox" style={{ width: 'auto' }} checked={hasDue} onChange={(e) => { setHasDue(e.target.checked); setAmountCollected(''); }} />
              Patient pays only part now (rest stays due)
            </label>
            {hasDue && (
              <div className="form-grid" style={{ alignItems: 'end', marginTop: 8 }}>
                <label><span>Amount Collecting Now</span>
                  <input type="number" min={0} max={netPayable} value={amountCollected} onChange={(e) => setAmountCollected(e.target.value)} placeholder="0" />
                </label>
                <div className="pay-stat-tile discount" style={{ margin: 0 }}>
                  <div className="label">Due Balance</div><div className="value">₹{dueNow}</div>
                </div>
              </div>
            )}
          </div>
        )}

        <div className="form-grid fd-pay-grid">
          {!isCredit && collectingNow > 0 && (
            <label><span>Payment Mode *</span>
              <select value={paymentMode} onChange={(e) => setPaymentMode(e.target.value)} required>
                <option value="">— Select —</option>
                <option>Cash</option><option>Card</option><option>UPI</option><option>Insurance</option>
              </select>
            </label>
          )}
          <label><span>Address (optional)</span>
            <input value={visitAddress} onChange={(e) => setVisitAddress(e.target.value)} />
          </label>
          {needsTransactionNumber && (
            <label><span>Payment Transaction Number *</span>
              <input
                value={transactionNumber}
                onChange={(e) => setTransactionNumber(e.target.value)}
                placeholder={`${paymentMode} reference / transaction ID`}
                required
              />
            </label>
          )}
          <label><span>Remarks{discountGiven ? ' *' : ' (optional)'}</span>
            <input
              value={remarks}
              onChange={(e) => setRemarks(e.target.value)}
              placeholder={discountGiven ? 'Required — reason for the discount' : 'Any notes…'}
              required={discountGiven}
            />
          </label>
        </div>
        {error && <p className="error-text">{error}</p>}
        <button className="fd-generate-btn" onClick={handleGenerateBill} disabled={generating || !hasItems || (!isCredit && collectingNow > 0 && !paymentMode)}>{generating ? 'Generating…' : 'Generate Bill'}</button>
      </div>
      </div>
    </div>
  );
}

import { useEffect, useState } from 'react';
import api from '../../api/client';
import SearchSelect from '../../components/SearchSelect';
import StatusSwitch from '../../components/StatusSwitch';
import { downloadFile } from '../../utils/download';
import { TEST_TYPE_OPTIONS, TEST_TYPE_LABEL } from '../../utils/testType';

// Horizontal tabs instead of one long vertical page - each master task
// (tests, prices, packages, bulk upload) gets the full width on its own.
const MASTER_TABS = [
  { key: 'tests', label: 'Test Master', count: ({ tests }) => tests.length },
  { key: 'prices', label: 'Price Updation', count: ({ prices }) => prices.length },
  { key: 'packages', label: 'Packages', count: ({ packages }) => packages.length },
  { key: 'bulk', label: 'Bulk Upload' },
];

function blankTest() {
  return { testCode: '', testName: '', category: '', testType: 'REGULAR' };
}

function blankPackage() {
  return { packageCode: '', packageName: '', price: '', testIds: [] };
}

export default function Masters() {
  const [tests, setTests] = useState([]);
  const [prices, setPrices] = useState([]);
  const [packages, setPackages] = useState([]);
  const [newTest, setNewTest] = useState(blankTest());
  const [groups, setGroups] = useState([]); // service groups created by Chief Admin
  const [priceForm, setPriceForm] = useState({ testId: '', price: '' });
  const [packageForm, setPackageForm] = useState(blankPackage());

  const [testPreview, setTestPreview] = useState(null);
  const [testFile, setTestFile] = useState(null);
  const [testUploadMessage, setTestUploadMessage] = useState('');

  const [pkgPreview, setPkgPreview] = useState(null);
  const [pkgFile, setPkgFile] = useState(null);
  const [pkgUploadMessage, setPkgUploadMessage] = useState('');

  const [error, setError] = useState('');
  const [tab, setTab] = useState('tests');
  const [search, setSearch] = useState(''); // filters the current tab's table
  const [pkgTestSearch, setPkgTestSearch] = useState(''); // filters the package test picker

  // Several locations: prices are edited per location. Main's are the
  // clinic's own prices (used on the other tabs); another location shows
  // its own price where set, otherwise Main's.
  const [locations, setLocations] = useState([]);
  const [restrictedTo, setRestrictedTo] = useState(null);
  const [priceLocationId, setPriceLocationId] = useState('');
  const [locationPrices, setLocationPrices] = useState(null); // null = showing Main prices
  const priceLocation = locations.find((l) => String(l.id) === String(priceLocationId));
  const branchSelected = !!priceLocation && !priceLocation.isMain;
  const locationParam = branchSelected ? { locationId: priceLocation.id } : {};

  async function loadAll() {
    const [testsRes, pricesRes, packagesRes] = await Promise.all([
      api.get('/masters/tests'),
      api.get('/masters/client-test-price'),
      api.get('/masters/packages'),
    ]);
    setTests(testsRes.data);
    setPrices(pricesRes.data);
    setPackages(packagesRes.data);
  }

  // Re-fetched whenever the dropdown is opened too, so a service group Chief
  // Admin creates while this screen is open shows up without a page reload.
  function loadGroups() {
    api.get('/masters/groups').then((r) => setGroups(r.data)).catch(() => {});
  }

  useEffect(() => {
    loadAll();
    loadGroups();
    api.get('/locations').then(({ data }) => {
      setLocations(data.locations);
      setRestrictedTo(data.restrictedTo);
      setPriceLocationId(String(data.restrictedTo || data.currentLocationId || ''));
    }).catch(() => {});
  }, []);

  function loadLocationPrices() {
    setLocationPrices(null);
    if (!branchSelected) return;
    api.get('/masters/client-test-price', { params: { locationId: priceLocation.id } })
      .then((r) => setLocationPrices(r.data))
      .catch((err) => setError(err.response?.data?.message || 'Failed to load location prices'));
  }

  useEffect(loadLocationPrices, [priceLocationId, locations]);

  async function handleResetToMain(testId) {
    setError('');
    try {
      await api.put('/masters/client-test-price', { testId, resetToMain: true, ...locationParam });
      loadLocationPrices();
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to reset price');
    }
  }

  async function handleCreateTest(e) {
    e.preventDefault();
    setError('');
    try {
      await api.post('/masters/tests', newTest);
      setNewTest(blankTest());
      loadAll();
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to create test');
    }
  }

  async function handleSetPrice(e) {
    e.preventDefault();
    setError('');
    try {
      await api.put('/masters/client-test-price', { testId: Number(priceForm.testId), price: Number(priceForm.price), ...locationParam });
      setPriceForm({ testId: '', price: '' });
      loadAll();
      loadLocationPrices();
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to set price');
    }
  }

  async function handleTestPreview(e) {
    e.preventDefault();
    if (!testFile) return;
    const formData = new FormData();
    formData.append('file', testFile);
    const { data } = await api.post('/masters/client-test-price/upload/preview', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
    setTestPreview(data);
  }

  async function handleTestCommit() {
    const rows = testPreview.preview.filter((r) => r.valid).map((r) => ({ testCode: r.testCode, price: r.price }));
    const { data } = await api.post('/masters/client-test-price/upload/commit', { rows, ...locationParam });
    setTestUploadMessage(`Uploaded${priceLocation ? ` for ${priceLocation.name}` : ''}: ${data.success.length} succeeded, ${data.errors.length} failed.`);
    setTestPreview(null);
    setTestFile(null);
    loadAll();
    loadLocationPrices();
  }

  function toggleTestSelection(testId) {
    setPackageForm((f) => ({
      ...f,
      testIds: f.testIds.includes(testId) ? f.testIds.filter((id) => id !== testId) : [...f.testIds, testId],
    }));
  }

  async function handleCreatePackage(e) {
    e.preventDefault();
    setError('');
    if (packageForm.testIds.length === 0) {
      setError('Select at least one test for the package');
      return;
    }
    try {
      await api.post('/masters/packages', { ...packageForm, price: Number(packageForm.price) });
      setPackageForm(blankPackage());
      loadAll();
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to create package');
    }
  }

  async function handlePkgPreview(e) {
    e.preventDefault();
    if (!pkgFile) return;
    const formData = new FormData();
    formData.append('file', pkgFile);
    const { data } = await api.post('/masters/packages/upload/preview', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
    setPkgPreview(data);
  }

  async function handlePkgCommit() {
    const rows = pkgPreview.preview.filter((r) => r.valid).map((r) => ({ packageCode: r.packageCode, price: r.price }));
    const { data } = await api.post('/masters/packages/upload/commit', { rows });
    setPkgUploadMessage(`Uploaded: ${data.success.length} succeeded, ${data.errors.length} failed.`);
    setPkgPreview(null);
    setPkgFile(null);
    loadAll();
  }

  // Active/Inactive here is for this clinic only - the shared Test Master and
  // other clinics are untouched. Switching Active a test Chief Admin made
  // Inactive turns it back on for this clinic alone (an override).
  async function setClientTestActive(test, active) {
    const chiefOff = test.active === false;
    if (!window.confirm(active
      ? `Make "${test.testName}" Active for your clinic?${chiefOff ? '\n\nChief Admin has switched this test off for all clinics - this turns it back on for your clinic only.' : ''}`
      : `Mark "${test.testName}" Inactive for your clinic?\n\nIt can't be billed until you make it Active again. Old bills and reports keep it.`)) return;
    try {
      await api.put(`/masters/client-test-price/${test.id}/status`, { active });
      loadAll();
    } catch (err) {
      window.alert(err.response?.data?.message || 'Could not change the test status');
    }
  }

  const priceRowByTestId = new Map(prices.map((p) => [p.testId ?? p.TestMaster?.id, p]));

  // Mirrors the server's isBillableForClient (utils/testStatus.js).
  const isActiveForClinic = (test, row) => !!row && row.active !== false && (test.active !== false || !!row.overrideChiefInactive);

  function testStatus(test) {
    const row = priceRowByTestId.get(test.id);
    if (!row) {
      return test.active === false
        ? <span className="badge EXPIRED" title="Switched off by Chief Admin for all clinics">Inactive (Chief Admin)</span>
        : <span className="badge PENDING">No price</span>;
    }
    if (isActiveForClinic(test, row)) {
      return test.active === false
        ? <span className="badge PAID" title="Chief Admin has this test off for all clinics - your clinic switched it back on">Active (your clinic)</span>
        : <span className="badge PAID">Active</span>;
    }
    return row.active === false
      ? <span className="badge EXPIRED">Inactive</span>
      : <span className="badge EXPIRED" title="Switched off by Chief Admin for all clinics - switch it Active to use it in your clinic">Inactive (Chief Admin)</span>;
  }

  function testActions(test) {
    const row = priceRowByTestId.get(test.id);
    if (!row) return null;
    return (
      <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
        <StatusSwitch active={isActiveForClinic(test, row)} onChange={(active) => setClientTestActive(test, active)} />
      </div>
    );
  }

  const priceByTestId = new Map(prices.map((p) => [p.testId ?? p.TestMaster?.id, Number(p.price)]));
  const q = search.trim().toLowerCase();
  const matches = (...fields) => !q || fields.some((f) => (f || '').toString().toLowerCase().includes(q));
  const pq = pkgTestSearch.trim().toLowerCase();
  const pickerTests = tests.filter((t) => !pq || `${t.testCode} ${t.testName}`.toLowerCase().includes(pq));
  const selectedTests = tests.filter((t) => packageForm.testIds.includes(t.id));
  const selectedTotal = selectedTests.reduce((sum, t) => sum + (priceByTestId.get(t.id) || 0), 0);

  const locationPicker = locations.length > 1 && (
    <label><span>Location</span>
      <select value={priceLocationId} onChange={(e) => setPriceLocationId(e.target.value)} disabled={!!restrictedTo}>
        {locations.map((l) => <option key={l.id} value={l.id}>{l.name}{l.isMain ? ' (Main)' : ''}</option>)}
      </select>
    </label>
  );
  const shownPrices = locationPrices || prices;
  // A branch's columns appear once its own price list has loaded.
  const branchShown = branchSelected && !!locationPrices;

  return (
    <div className="card masters-card">
      <div className="masters-head">
        <h3 style={{ margin: 0 }}>Masters &amp; Pricing</h3>
        <div className="status-tabs compact">
          {MASTER_TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              className={`status-tab ${tab === t.key ? 'active' : ''}`}
              onClick={() => { setTab(t.key); setSearch(''); }}
            >
              {t.label}
              {t.count && <span className="tab-count">{t.count({ tests, prices, packages })}</span>}
            </button>
          ))}
        </div>
      </div>

      {tab === 'tests' && (
        <>
          <form onSubmit={handleCreateTest} className="masters-row">
            <label><span>Test Code</span><input value={newTest.testCode} onChange={(e) => setNewTest((f) => ({ ...f, testCode: e.target.value }))} required /></label>
            <label className="grow"><span>Test Name</span><input value={newTest.testName} onChange={(e) => setNewTest((f) => ({ ...f, testName: e.target.value }))} required /></label>
            <label><span>Service Group</span>
              <select value={newTest.category} onFocus={loadGroups} onChange={(e) => setNewTest((f) => ({ ...f, category: e.target.value }))} required>
                <option value="">— Select —</option>
                {groups.map((g) => <option key={g.name} value={g.name}>{g.name}</option>)}
              </select>
            </label>
            <label><span>Test Type</span>
              <select value={newTest.testType} onChange={(e) => setNewTest((f) => ({ ...f, testType: e.target.value }))} required>
                {TEST_TYPE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </label>
            <button type="submit">Add Test</button>
            <input className="masters-search" placeholder="Search tests…" value={search} onChange={(e) => setSearch(e.target.value)} />
          </form>
          {error && <p className="error-text">{error}</p>}
          {groups.length === 0 && <p className="cell-sub">No service groups yet - Chief Admin creates them under Test Master.</p>}
          <div className="masters-table-wrap">
            <table className="orders-table">
              <thead><tr><th>Code</th><th>Name</th><th>Group</th><th>Type</th><th>Parameters</th><th>Status</th><th></th></tr></thead>
              <tbody>
                {tests.filter((t) => matches(t.testCode, t.testName)).map((t) => (
                  <tr key={t.id}>
                    <td style={{ whiteSpace: 'nowrap' }}>{t.testCode}</td>
                    <td>{t.testName}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>{t.category || '—'}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>{TEST_TYPE_LABEL[t.testType] || 'Regular'}</td>
                    <td className="cell-sub" style={{ whiteSpace: 'normal' }}>{(t.ParameterMasters || []).map((p) => p.parameterName).join(', ') || '—'}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>{testStatus(t)}</td>
                    <td>{testActions(t)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {tab === 'prices' && (
        <>
          <form onSubmit={handleSetPrice} className="masters-row">
            {locationPicker}
            <div className="grow"><span className="field-label">Test</span>
              <SearchSelect
                options={tests.map((t) => ({ value: t.id, label: `${t.testCode} — ${t.testName}` }))}
                value={priceForm.testId}
                onChange={(testId) => setPriceForm((f) => ({ ...f, testId }))}
                placeholder="Search by test code or name…"
              />
            </div>
            <label><span>Price (₹)</span><input type="number" value={priceForm.price} onChange={(e) => setPriceForm((f) => ({ ...f, price: e.target.value }))} required /></label>
            <button type="submit" disabled={!priceForm.testId}>Set Price</button>
            <input className="masters-search" placeholder="Search price list…" value={search} onChange={(e) => setSearch(e.target.value)} />
          </form>
          {error && <p className="error-text">{error}</p>}
          {branchSelected && (
            <p className="cell-sub">
              {priceLocation.name} uses the Main location's price for every test unless you set its own price here.
            </p>
          )}
          <div className="masters-table-wrap">
            <table className="orders-table">
              <thead><tr><th>Test Code</th><th>Test Name</th><th style={{ textAlign: 'right' }}>Price</th>{branchShown && <th style={{ textAlign: 'right' }}>Main Price</th>}<th>Status</th><th></th></tr></thead>
              <tbody>
                {shownPrices.filter((p) => p.TestMaster && matches(p.TestMaster.testCode, p.TestMaster.testName)).map((p) => (
                  <tr key={p.id}>
                    <td style={{ whiteSpace: 'nowrap' }}>{p.TestMaster.testCode}</td>
                    <td>{p.TestMaster.testName}</td>
                    <td style={{ textAlign: 'right', fontWeight: 600, whiteSpace: 'nowrap' }}>
                      ₹{p.price}
                      {branchShown && (p.ownPrice
                        ? <span className="badge PAID" style={{ marginLeft: 6 }} title={`${priceLocation.name}'s own price`}>Own</span>
                        : <span className="cell-sub" style={{ marginLeft: 6 }}>(Main)</span>)}
                    </td>
                    {branchShown && (
                      <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                        ₹{p.mainPrice}
                        {p.ownPrice && (
                          <button type="button" className="secondary" style={{ marginLeft: 6, padding: '2px 8px', fontSize: 12 }} onClick={() => handleResetToMain(p.testId)}>
                            Use Main
                          </button>
                        )}
                      </td>
                    )}
                    <td style={{ whiteSpace: 'nowrap' }}>{testStatus(p.TestMaster)}</td>
                    <td>{testActions(p.TestMaster)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {tab === 'packages' && (
        <>
          <div className="pkg-builder">
            <form onSubmit={handleCreatePackage} className="pkg-form">
              <div className="pkg-form-title">New package</div>
              <label><span>Package Code</span><input value={packageForm.packageCode} onChange={(e) => setPackageForm((f) => ({ ...f, packageCode: e.target.value }))} required /></label>
              <label><span>Package Name</span><input value={packageForm.packageName} onChange={(e) => setPackageForm((f) => ({ ...f, packageName: e.target.value }))} required /></label>
              <label><span>Package Price (₹)</span><input type="number" value={packageForm.price} onChange={(e) => setPackageForm((f) => ({ ...f, price: e.target.value }))} required /></label>
              <div className="pkg-selected">
                <div className="pkg-selected-head">
                  <span>{selectedTests.length} test{selectedTests.length === 1 ? '' : 's'} selected</span>
                  {selectedTotal > 0 && <span title="Sum of the individual test prices">Individually ₹{selectedTotal.toFixed(2)}</span>}
                </div>
                <div className="pkg-selected-chips">
                  {selectedTests.map((t) => (
                    <span key={t.id} className="pkg-chip">
                      {t.testName}
                      <button type="button" aria-label={`Remove ${t.testName}`} onClick={() => toggleTestSelection(t.id)}>×</button>
                    </span>
                  ))}
                  {selectedTests.length === 0 && <span className="cell-sub">Pick tests from the list →</span>}
                </div>
              </div>
              {error && <p className="error-text">{error}</p>}
              <button type="submit">Create Package</button>
            </form>

            <div className="pkg-picker">
              <div className="pkg-picker-head">
                <input placeholder="Search tests by code or name…" value={pkgTestSearch} onChange={(e) => setPkgTestSearch(e.target.value)} autoFocus />
                <span className="cell-sub">{pickerTests.length} of {tests.length}</span>
              </div>
              <div className="pkg-picker-list">
                {pickerTests.map((t) => {
                  const on = packageForm.testIds.includes(t.id);
                  return (
                    <label key={t.id} className={`pkg-pick${on ? ' on' : ''}`}>
                      <input type="checkbox" checked={on} onChange={() => toggleTestSelection(t.id)} />
                      <span className="code">{t.testCode}</span>
                      <span className="name">{t.testName}</span>
                      {priceByTestId.has(t.id) && <span className="price">₹{priceByTestId.get(t.id)}</span>}
                    </label>
                  );
                })}
                {pickerTests.length === 0 && <p className="cell-sub" style={{ padding: 8 }}>No tests match “{pkgTestSearch}”.</p>}
              </div>
            </div>
          </div>

          <div className="masters-row" style={{ marginTop: 12 }}>
            <strong style={{ fontSize: 13 }}>Existing packages</strong>
            <input className="masters-search" placeholder="Search packages…" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <div className="masters-table-wrap">
            <table className="orders-table">
              <thead><tr><th>Code</th><th>Name</th><th>Tests Included</th><th style={{ textAlign: 'right' }}>Price</th></tr></thead>
              <tbody>
                {packages.filter((p) => matches(p.packageCode, p.packageName)).map((p) => (
                  <tr key={p.id}>
                    <td style={{ whiteSpace: 'nowrap' }}>{p.packageCode}</td>
                    <td>{p.packageName}</td>
                    <td className="cell-sub" style={{ whiteSpace: 'normal' }}>{(p.TestMasters || []).map((t) => t.testName).join(', ')}</td>
                    <td style={{ textAlign: 'right', fontWeight: 600 }}>₹{p.price}</td>
                  </tr>
                ))}
                {packages.length === 0 && <tr><td colSpan={4}>No packages yet.</td></tr>}
              </tbody>
            </table>
          </div>
        </>
      )}

      {tab === 'bulk' && (
        <div className="bulk-grid">
          <div className="bulk-box">
            <div className="pkg-form-title">Test prices</div>
            <p className="cell-sub">Excel columns: TEST_CODE, TEST_NAME, PRICE{branchSelected ? ` - uploads set ${priceLocation.name}'s own prices` : ''}</p>
            {locationPicker && <div className="masters-row">{locationPicker}</div>}
            <form onSubmit={handleTestPreview} className="masters-row">
              <button type="button" className="secondary" onClick={() => downloadFile(`/masters/client-test-price/template${branchSelected ? `?locationId=${priceLocation.id}` : ''}`, 'test-price-template.xlsx')}>
                Template
              </button>
              <input type="file" accept=".xlsx,.xls,.csv" onChange={(e) => setTestFile(e.target.files[0])} />
              <button type="submit">Preview</button>
            </form>
            {testPreview && (
              <>
                <p className="cell-sub">{testPreview.validRows} valid, {testPreview.invalidRows} invalid of {testPreview.totalRows} rows.</p>
                <table className="orders-table">
                  <thead><tr><th>Row</th><th>Test Code</th><th>Price</th><th>Status</th></tr></thead>
                  <tbody>
                    {testPreview.preview.map((r) => (
                      <tr key={r.row}>
                        <td>{r.row}</td><td>{r.testCode}</td><td>{r.price}</td>
                        <td>{r.valid ? <span className="badge PAID">Valid</span> : <span className="badge EXPIRED">{r.errors.join('; ')}</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <button onClick={handleTestCommit} disabled={testPreview.validRows === 0} style={{ marginTop: 8 }}>
                  Upload {testPreview.validRows} Valid Rows
                </button>
              </>
            )}
            {testUploadMessage && <p className="cell-sub">{testUploadMessage}</p>}
          </div>

          <div className="bulk-box">
            <div className="pkg-form-title">Package prices</div>
            <p className="cell-sub">Excel columns: PACKAGE_CODE, PACKAGE_NAME, PRICE</p>
            <form onSubmit={handlePkgPreview} className="masters-row">
              <button type="button" className="secondary" onClick={() => downloadFile('/masters/packages/template', 'package-price-template.xlsx')}>
                Template
              </button>
              <input type="file" accept=".xlsx,.xls,.csv" onChange={(e) => setPkgFile(e.target.files[0])} />
              <button type="submit">Preview</button>
            </form>
            {pkgPreview && (
              <>
                <p className="cell-sub">{pkgPreview.validRows} valid, {pkgPreview.invalidRows} invalid of {pkgPreview.totalRows} rows.</p>
                <table className="orders-table">
                  <thead><tr><th>Row</th><th>Package Code</th><th>Price</th><th>Status</th></tr></thead>
                  <tbody>
                    {pkgPreview.preview.map((r) => (
                      <tr key={r.row}>
                        <td>{r.row}</td><td>{r.packageCode}</td><td>{r.price}</td>
                        <td>{r.valid ? <span className="badge PAID">Valid</span> : <span className="badge EXPIRED">{r.errors.join('; ')}</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <button onClick={handlePkgCommit} disabled={pkgPreview.validRows === 0} style={{ marginTop: 8 }}>
                  Upload {pkgPreview.validRows} Valid Rows
                </button>
              </>
            )}
            {pkgUploadMessage && <p className="cell-sub">{pkgUploadMessage}</p>}
          </div>
        </div>
      )}
    </div>
  );
}

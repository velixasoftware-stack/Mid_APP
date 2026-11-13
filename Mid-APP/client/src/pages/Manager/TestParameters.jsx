import { useEffect, useMemo, useState } from 'react';
import api from '../../api/client';
import ParamOrder from '../../components/ParamOrder';
import { Icon } from '../../components/Icons';
import SpecimenEditor from '../../components/SpecimenEditor';
import SearchSelect from '../../components/SearchSelect';
import {
  blankRangeTexts, saveRangeTexts, RangeRow, RangeTextField, OldRangeTextNote,
} from '../../components/NormalRangeText';
import { downloadFile } from '../../utils/download';

const GENDER_OPTIONS = ['All', 'Male', 'Female', 'Other'];
const AGE_UNIT_OPTIONS = ['Years', 'Months', 'Days'];
const AGE_UNIT_ABBR = { Years: 'y', Months: 'm', Days: 'd' };
const emptyRangeRow = () => ({ gender: 'All', ageMin: '', ageMax: '', ageUnit: 'Years', ageMaxUnit: 'Years', normalRangeLow: '', normalRangeHigh: '', rangeText: '' });
// A range row counts once it has a range or its own printed text (e.g. "Negative").
const rowFilled = (r) => !!(r.normalRangeLow || r.normalRangeHigh || r.rangeText?.trim());
const blankParamForm = () => ({ sequence: '', parameterName: '', unit: '', method: '', isInterpretation: false, normalRangeLow: '', normalRangeHigh: '', ...blankRangeTexts(), description: '' });
// Narrower than the app-wide .form-grid default (minmax 200px) so Gender/Age/Unit/Range fields
// wrap two-three to a row instead of stacking one-per-row on a narrow/mobile screen.
const rangeGridStyle = { alignItems: 'end', gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))' };

function pillClass(gender) {
  if (gender === 'Male') return 'range-pill male';
  if (gender === 'Female') return 'range-pill female';
  return 'range-pill neutral';
}

/** Every age/gender-specific rule shown as its own pill, or the parameter's flat default range if it has none. */
function RangeMatrix({ param }) {
  if (param.isInterpretation) {
    return <span className="range-pill interpretation">Free-text interpretation</span>;
  }
  const ranges = param.ParameterNormalRanges || [];
  if (ranges.length === 0) {
    return <span className="range-pill neutral">{param.normalRangeLow || '—'}–{param.normalRangeHigh || '—'} {param.unit || ''}</span>;
  }
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap' }}>
      {ranges.map((r) => (
        <span key={r.id} className={pillClass(r.gender)}>
          {r.gender} · {r.ageMin ?? '0'}{AGE_UNIT_ABBR[r.ageUnit] || 'y'}-{r.ageMax ?? '∞'}{AGE_UNIT_ABBR[r.ageMaxUnit || r.ageUnit] || 'y'} · {r.normalRangeLow || '—'}-{r.normalRangeHigh || '—'} {param.unit || ''}
        </span>
      ))}
    </div>
  );
}

const NO_PARAM = {};

export default function TestParameters() {
  const [tests, setTests] = useState([]);
  const [shortNames, setShortNames] = useState([]);
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('All');
  const [selectedTestId, setSelectedTestId] = useState(null);
  const [error, setError] = useState('');

  const [showParamModal, setShowParamModal] = useState(false);
  const [paramForm, setParamForm] = useState(blankParamForm());
  const [rangeRows, setRangeRows] = useState([]); // extra age/gender-specific rules for the parameter being created
  // Clubs Range Low/High and the age/gender rows into the printed Normal Range box until edited by hand.
  const [savingParam, setSavingParam] = useState(false);
  const [paramCopySearch, setParamCopySearch] = useState(''); // "copy from an existing parameter" search box in the Add Parameter modal

  const [shortNameForm, setShortNameForm] = useState({ testId: '', shortName: '' });
  const [savingTrendId, setSavingTrendId] = useState(null); // parameter whose Trend tick is saving

  const [manageParam, setManageParam] = useState(null); // parameter row whose ranges are being managed
  const [newRange, setNewRange] = useState(emptyRangeRow());
  // Manage ranges: the printed Normal Range boxes, filled from the saved
  // ranges plus the one being typed - saved by the same button as the range.
  // Any parameter: a universal one is edited as this clinic's own copy (server side).
  const [rangeError, setRangeError] = useState('');
  const [savingRange, setSavingRange] = useState(false);

  const [bulkPreview, setBulkPreview] = useState(null);
  const [bulkFile, setBulkFile] = useState(null);
  const [bulkMessage, setBulkMessage] = useState('');

  async function loadAll() {
    const [testsRes, shortNamesRes] = await Promise.all([
      api.get('/test-config/tests'),
      api.get('/test-config/test-shortname'),
    ]);
    // Only tests active for this clinic (its own switch, or Chief Admin's when
    // the clinic hasn't overridden it) - inactive ones are hidden here.
    const activeTests = testsRes.data.filter((t) => t.activeForClient !== false);
    setTests(activeTests);
    setShortNames(shortNamesRes.data);
    return { tests: activeTests };
  }
  useEffect(() => { loadAll(); }, []);

  const selectedTest = tests.find((t) => t.id === selectedTestId);

  const categories = useMemo(() => {
    const set = new Set(tests.map((t) => t.category).filter(Boolean));
    return [...set].sort();
  }, [tests]);

  const filteredTests = useMemo(() => {
    const q = search.trim().toLowerCase();
    return tests.filter((t) => {
      if (categoryFilter !== 'All' && (t.category || 'Uncategorized') !== categoryFilter) return false;
      if (!q) return true;
      return t.testName.toLowerCase().includes(q) || t.testCode.toLowerCase().includes(q);
    });
  }, [tests, search, categoryFilter]);

  // Every parameter already defined on any test, deduplicated by id and
  // flattened for the "assign an existing parameter" search in the Add
  // Parameter modal - so a parameter like "Hemoglobin" doesn't need to be
  // recreated for every test it belongs to. Assigning shares the same row
  // (code, unit, method, ranges) rather than duplicating it, so updating a
  // range later updates it everywhere it's assigned.
  const existingParamLibrary = useMemo(() => {
    const seen = new Map();
    for (const t of tests) {
      for (const p of t.ParameterMasters || []) {
        if (!seen.has(p.id)) seen.set(p.id, { ...p, testName: t.testName });
      }
    }
    return [...seen.values()];
  }, [tests]);

  const paramCopyMatches = useMemo(() => {
    const q = paramCopySearch.trim().toLowerCase();
    if (!q) return [];
    const alreadyOnTest = new Set((selectedTest?.ParameterMasters || []).map((p) => p.id));
    return existingParamLibrary
      .filter((p) => !alreadyOnTest.has(p.id) && p.parameterName.toLowerCase().includes(q))
      .slice(0, 8);
  }, [existingParamLibrary, paramCopySearch, selectedTest]);

  async function assignExistingParam(p) {
    if (savingParam) return;
    setError('');
    setSavingParam(true);
    try {
      await api.post(`/test-config/tests/${selectedTestId}/parameters/${p.id}/assign`);
      setShowParamModal(false);
      loadAll();
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to assign parameter');
    } finally {
      setSavingParam(false);
    }
  }

  function openAddParameter() {
    setError('');
    setParamForm(blankParamForm());
    setRangeRows([]);
    setParamCopySearch('');
    setShowParamModal(true);
  }

  async function handleAddParameter(e) {
    e.preventDefault();
    if (savingParam) return; // guard against rapid double-submit creating a duplicate parameter
    setError('');
    const normalRanges = paramForm.isInterpretation ? [] : rangeRows.filter(rowFilled);
    setSavingParam(true);
    try {
      await api.post(`/test-config/tests/${selectedTestId}/parameters`, { ...paramForm, normalRanges });
      setShowParamModal(false);
      loadAll();
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to add parameter');
    } finally {
      setSavingParam(false);
    }
  }

  function addRangeRow() {
    setRangeRows((rows) => [...rows, emptyRangeRow()]);
  }
  function updateRangeRow(idx, field, value) {
    setRangeRows((rows) => rows.map((r, i) => (i === idx ? { ...r, [field]: value } : r)));
  }
  function removeRangeRow(idx) {
    setRangeRows((rows) => rows.filter((_, i) => i !== idx));
  }

  function openManageRanges(param) {
    setManageParam(param);
    setNewRange(emptyRangeRow());
    setRangeError('');
  }

  // Adds the age/gender range typed below the table (with its own printed text, if any).
  async function handleAddExistingRange(e) {
    e.preventDefault();
    if (savingRange) return; // guard against rapid double-submit creating a duplicate range rule
    setRangeError('');
    if (!rowFilled(newRange)) {
      setRangeError('Enter a Range Low / High (or the text printed on the report), then Save.');
      return;
    }
    setSavingRange(true);
    try {
      await api.post(`/test-config/parameters/${manageParam.id}/ranges`, newRange);
      setNewRange(emptyRangeRow());
      const data = await loadAll();
      const freshTest = data.tests.find((t) => t.id === selectedTestId);
      setManageParam((prev) => freshTest?.ParameterMasters?.find((p) => p.id === prev.id) || prev);
    } catch (err) {
      setRangeError(err.response?.data?.message || 'Failed to add normal range');
    } finally {
      setSavingRange(false);
    }
  }

  // Drops this clinic's own copy of a universal parameter's ranges - it
  // follows Chief Admin's ranges (and their later changes) again.
  async function resetToChiefAdmin() {
    if (!window.confirm(`Use Chief Admin's normal ranges for ${manageParam.parameterName} again?\n\nYour clinic's own ranges and printed text for it will be removed.`)) return;
    setRangeError('');
    setSavingRange(true);
    try {
      await api.delete(`/test-config/parameters/${manageParam.id}/customization`);
      const data = await loadAll();
      const freshTest = data.tests.find((t) => t.id === selectedTestId);
      setManageParam((prev) => freshTest?.ParameterMasters?.find((p) => p.id === prev.id) || prev);
    } catch (err) {
      setRangeError(err.response?.data?.message || 'Failed to reset');
    } finally {
      setSavingRange(false);
    }
  }

  async function refreshManageParam() {
    const data = await loadAll();
    const freshTest = data.tests.find((t) => t.id === selectedTestId);
    setManageParam((prev) => freshTest?.ParameterMasters?.find((p) => p.id === prev.id) || prev);
  }

  // Saves an edited age/gender row (incl. the Normal Range printed for patients it matches).
  async function handleUpdateRange(rangeId, changes) {
    setRangeError('');
    try {
      await api.put(`/test-config/parameters/${manageParam.id}/ranges/${rangeId}`, changes);
      await refreshManageParam();
    } catch (err) {
      setRangeError(err.response?.data?.message || 'Failed to save the range');
      throw err; // keeps the row open for correcting
    }
  }

  async function handleClearOldRangeText() {
    setRangeError('');
    try {
      await saveRangeTexts('/test-config', manageParam.id, { normalRangeText: '', normalRangeTextMale: '', normalRangeTextFemale: '' });
      await refreshManageParam();
    } catch (err) {
      setRangeError(err.response?.data?.message || 'Failed to clear the older printed text');
    }
  }

  async function handleDeleteRange(rangeId) {
    await api.delete(`/test-config/parameters/${manageParam.id}/ranges/${rangeId}`);
    const data = await loadAll();
    const freshTest = data.tests.find((t) => t.id === selectedTestId);
    setManageParam((prev) => freshTest?.ParameterMasters?.find((p) => p.id === prev.id) || prev);
  }

  async function handleSetShortName(e) {
    e.preventDefault();
    await api.put('/test-config/test-shortname', {
      testId: Number(shortNameForm.testId), shortName: shortNameForm.shortName,
    });
    setShortNameForm({ testId: '', shortName: '' });
    loadAll();
  }

  async function handleBulkPreview(e) {
    e.preventDefault();
    if (!bulkFile) return;
    setBulkMessage('');
    const formData = new FormData();
    formData.append('file', bulkFile);
    const { data } = await api.post('/test-config/test-shortname/upload/preview', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
    setBulkPreview(data);
  }

  async function handleBulkCommit() {
    const rows = bulkPreview.preview.filter((r) => r.valid).map((r) => ({ testCode: r.testCode, shortName: r.shortName }));
    const { data } = await api.post('/test-config/test-shortname/upload/commit', { rows });
    setBulkMessage(`Uploaded: ${data.success.length} succeeded, ${data.errors.length} failed.`);
    setBulkPreview(null);
    setBulkFile(null);
    loadAll();
  }


  // Ticks/unticks "show trend on the report" for a parameter. Stored per
  // parameter, so it changes on every test the parameter is mapped to - the
  // reload below shows that across the whole test list.
  async function setParamTrend(p, showTrend) {
    setError('');
    setSavingTrendId(p.id);
    try {
      await api.put(`/test-config/parameters/${p.id}/trend`, { showTrend });
      await loadAll();
    } catch (err) {
      setError(err.response?.data?.message || 'Could not update the trend setting');
    } finally {
      setSavingTrendId(null);
    }
  }

  // Removes a parameter from the selected test (switched off, or unlinked if
  // it was shared in from another test) - results already released keep it.
  async function removeParam(p) {
    const scope = p.clientId
      ? ''
      : '\n\nThis is a universal parameter: it is removed for YOUR LAB ONLY. Other labs and the master keep it, and you can restore it any time.';
    if (!window.confirm(`Remove "${p.parameterName}" from ${selectedTest.testName}?

It will no longer appear on result entry. Reports already released keep their values.${scope}`)) return;
    try {
      await api.delete(`/test-config/tests/${selectedTest.id}/parameters/${p.id}`);
      await loadAll();
    } catch (err) {
      window.alert(err.response?.data?.message || 'Could not remove the parameter');
    }
  }

  // Brings back a universal parameter removed for this lab only.
  async function restoreParam(p) {
    try {
      await api.post(`/test-config/tests/${selectedTest.id}/parameters/${p.id}/restore`);
      await loadAll();
    } catch (err) {
      window.alert(err.response?.data?.message || 'Could not restore the parameter');
    }
  }
  return (
    <div>
      <div className="card" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <span className="icon-badge" style={{ width: 40, height: 40 }}><Icon name="masters" size={20} /></span>
        <div>
          <h3 style={{ margin: 0 }}>Test Parameters</h3>
          <p style={{ margin: 0, fontSize: 13, color: '#64748b' }}>Reference ranges by gender &amp; age</p>
        </div>
      </div>
      <p style={{ fontSize: 13, color: '#64748b', margin: '0 0 12px' }}>
        Add your own parameters for a test. A parameter you add here is private to your lab — it never shows up
        for, or gets added to, any other client. Universal parameters (set up centrally) still appear alongside
        your own, marked "Universal" below.
      </p>

      {error && <p className="error-text">{error}</p>}

      <div className="masters-layout">
        <div className="card masters-sidebar">
          <div className="masters-sidebar-head">
            <span>TESTS</span>
          </div>
          <select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)}>
            <option value="All">All groups ({tests.length})</option>
            {categories.map((c) => (
              <option key={c} value={c}>{c} ({tests.filter((t) => t.category === c).length})</option>
            ))}
          </select>
          <input placeholder="Search tests…" value={search} onChange={(e) => setSearch(e.target.value)} />
          <div className="test-pick-list">
            {filteredTests.map((t) => (
              <button
                key={t.id}
                type="button"
                className={`test-pick-card${t.id === selectedTestId ? ' active' : ''}`}
                onClick={() => setSelectedTestId(t.id)}
              >
                <strong>{t.testName}</strong>
                <span className="meta"><span className="test-code">{t.testCode}</span> · {t.category || 'Uncategorized'} · {(t.ParameterMasters || []).length} param(s)</span>
              </button>
            ))}
            {filteredTests.length === 0 && <p style={{ fontSize: 13, color: '#94a3b8' }}>No tests found.</p>}
          </div>
        </div>

        <div className="card masters-detail">
          {!selectedTest && <p className="masters-empty">Select a test on the left to view or add its parameters.</p>}
          {selectedTest && (
            <>
              <div className="masters-detail-head">
                <div>
                  <h2>{selectedTest.testName}</h2>
                  <p className="meta">
                    <span className="test-code">{selectedTest.testCode}</span> · {selectedTest.category || 'Uncategorized'} · {selectedTest.clientSampleType || selectedTest.sampleType || 'Sample type not set'} ·{' '}
                    {(selectedTest.ParameterMasters || []).length} parameter(s) configured
                  </p>
                  <SpecimenEditor test={selectedTest} onSaved={loadAll} />
                </div>
                <button type="button" onClick={openAddParameter}>+ Add Parameter</button>
              </div>
              <table>
                <thead><tr><th>Seq</th><th>Code</th><th>Parameter</th><th>Unit</th><th>Range Matrix</th><th>Source</th><th title="Show this parameter's trend on patient reports - applies on every test it's mapped to">Trend</th><th></th></tr></thead>
                <tbody>
                  {(selectedTest.ParameterMasters || []).map((p) => (
                    <tr key={p.id}>
                      <td><ParamOrder apiBase="/test-config" testId={selectedTest.id} param={p} onSaved={loadAll} /></td>
                      <td>{p.parameterCode || '—'}</td>
                      <td>
                        {p.parameterName}
                        {p.isAssigned && (
                          <span className="range-pill neutral" style={{ marginLeft: 6 }} title="Shared with another test - editing its range here updates it everywhere it's assigned">
                            Shared
                          </span>
                        )}
                        {p.method && <div style={{ fontSize: 11, color: '#94a3b8' }}>{p.method}</div>}
                      </td>
                      <td>{p.unit || '—'}</td>
                      <td><RangeMatrix param={p} /></td>
                      <td>
                        {p.clientId ? <span className="badge PENDING_COLLECTION">Your Parameter</span> : <span className="badge PAID">Universal</span>}
                        {!p.clientId && p.customizedForClient && <div style={{ fontSize: 11, color: '#b45309', marginTop: 2 }}>Your ranges</div>}
                      </td>
                      <td>
                        {!p.isInterpretation && (
                          <input
                            type="checkbox"
                            style={{ width: 16, height: 16 }}
                            checked={!!p.showTrend}
                            disabled={savingTrendId === p.id}
                            onChange={(e) => setParamTrend(p, e.target.checked)}
                            title={`Show ${p.parameterName} trend on patient reports - on every test it's mapped to`}
                          />
                        )}
                      </td>
                      <td>
                        <div className="order-actions">
                          <button type="button" className="secondary icon-btn" title="Manage ranges" onClick={() => openManageRanges(p)}>
                            <Icon name="edit" size={15} />
                          </button>
                          <button
                            type="button" className="icon-btn remove-param-btn"
                            title={p.clientId ? 'Remove this parameter from the test' : 'Remove from this test for your lab only (other labs keep it)'}
                            onClick={() => removeParam(p)}
                          >
                            ×
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {(selectedTest.ParameterMasters || []).length === 0 && <tr><td colSpan={8}>No parameters yet for this test.</td></tr>}
                </tbody>
              </table>
              {(selectedTest.HiddenParameters || []).length > 0 && (
                <div style={{ marginTop: 14 }}>
                  <h4 style={{ margin: '0 0 4px' }}>Removed for your lab</h4>
                  <p style={{ fontSize: 12, color: '#64748b', margin: '0 0 6px' }}>
                    Universal parameters you removed from this test. Only your lab is affected - other labs still have them.
                  </p>
                  <table>
                    <tbody>
                      {selectedTest.HiddenParameters.map((p) => (
                        <tr key={p.id}>
                          <td>{p.parameterName}</td>
                          <td>{p.unit || '—'}</td>
                          <td style={{ textAlign: 'right' }}>
                            <button type="button" className="secondary" onClick={() => restoreParam(p)}>Restore</button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {showParamModal && selectedTest && (
        <div className="modal-overlay" onClick={() => setShowParamModal(false)}>
          <div className="modal-card" style={{ textAlign: 'left', width: 620, maxHeight: 'calc(100vh - 32px)', overflowY: 'auto' }} onClick={(e) => e.stopPropagation()}>
            <h2>Add Parameter — {selectedTest.testName}</h2>
            <p style={{ fontSize: 13, color: '#64748b' }}>The parameter code is generated automatically - no need to type one.</p>

            <div style={{ marginBottom: 14, position: 'relative' }}>
              <label><span>Assign an existing parameter (optional)</span>
                <input
                  value={paramCopySearch}
                  onChange={(e) => setParamCopySearch(e.target.value)}
                  placeholder="Search a parameter already used on another test, e.g. Hemoglobin"
                />
              </label>
              <p style={{ fontSize: 12, color: '#94a3b8', margin: '-8px 0 0' }}>
                Selecting a match attaches it to this test immediately - same code, unit and ranges shared
                everywhere it's used, so updating its range here updates it for every test that uses it too.
                No need to fill the form below.
              </p>
              {paramCopyMatches.length > 0 && (
                <div style={{
                  position: 'absolute', zIndex: 5, top: '100%', left: 0, right: 0,
                  background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8,
                  boxShadow: '0 8px 20px -6px rgba(15,23,42,0.15)', maxHeight: 220, overflowY: 'auto',
                }}>
                  {paramCopyMatches.map((p) => (
                    <button
                      type="button"
                      key={p.id}
                      onClick={() => assignExistingParam(p)}
                      disabled={savingParam}
                      style={{
                        display: 'block', width: '100%', textAlign: 'left', background: 'transparent',
                        color: '#1a1a1a', border: 'none', borderBottom: '1px solid #f1f5f9',
                        padding: '8px 12px', fontSize: 13, borderRadius: 0,
                      }}
                    >
                      <strong>{p.parameterName}</strong>
                      <span style={{ color: '#64748b' }}> — {p.unit || 'no unit'} · from {p.testName}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            <p style={{ fontSize: 13, fontWeight: 600, margin: '18px 0 2px' }}>Or create a brand-new parameter</p>
            <form onSubmit={handleAddParameter}>
              <div className="form-grid" style={{ alignItems: 'end' }}>
                <label style={{ maxWidth: 120 }}><span>Sequence No</span>
                  <input type="number" min="1" max="999" value={paramForm.sequence} onChange={(e) => setParamForm((f) => ({ ...f, sequence: e.target.value }))} placeholder="Auto" />
                </label>
                <label><span>Parameter Name</span>
                  <input value={paramForm.parameterName} onChange={(e) => setParamForm((f) => ({ ...f, parameterName: e.target.value }))} required />
                </label>
                <label><span>Unit</span>
                  <input value={paramForm.unit} onChange={(e) => setParamForm((f) => ({ ...f, unit: e.target.value }))} />
                </label>
                <label><span>Method</span>
                  <input value={paramForm.method} onChange={(e) => setParamForm((f) => ({ ...f, method: e.target.value }))} placeholder="e.g. Photometry" />
                </label>
                {!paramForm.isInterpretation && (
                  <>
                    <label><span>Default Range Low</span>
                      <input value={paramForm.normalRangeLow} onChange={(e) => setParamForm((f) => ({ ...f, normalRangeLow: e.target.value }))} />
                    </label>
                    <label><span>Default Range High</span>
                      <input value={paramForm.normalRangeHigh} onChange={(e) => setParamForm((f) => ({ ...f, normalRangeHigh: e.target.value }))} />
                    </label>
                  </>
                )}
              </div>

              <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10 }}>
                <input
                  type="checkbox"
                  checked={paramForm.isInterpretation}
                  onChange={(e) => setParamForm((f) => ({ ...f, isInterpretation: e.target.checked }))}
                  style={{ width: 16, height: 16 }}
                />
                <span>This is a free-text interpretation parameter (e.g. a Widal conclusion, culture &amp; sensitivity report) - no numeric value or normal range</span>
              </label>

              <label style={{ display: 'block', marginTop: 10 }}><span>Description (clinical notes, interpretation, etc. — optional)</span>
                <textarea
                  rows={5}
                  value={paramForm.description}
                  onChange={(e) => setParamForm((f) => ({ ...f, description: e.target.value }))}
                  placeholder="Longer notes about this parameter, shown to lab staff when entering/reviewing results"
                />
              </label>

              {paramForm.isInterpretation ? (
                <p style={{ fontSize: 13, color: '#64748b', marginTop: 10 }}>
                  Result entry will show a large text box for this parameter instead of a numeric value, and it'll
                  print as its own block below the test's result table on the report.
                </p>
              ) : (
                <div style={{ marginTop: 10 }}>
                  <p style={{ fontSize: 13, color: '#64748b', marginBottom: 6 }}>
                    Optional age/gender-specific ranges (e.g. Male 18-60, Female 18-60). The default range above is
                    used whenever a patient doesn't match any of these.
                  </p>
                  {rangeRows.map((r, idx) => (
                    <div key={idx} className="form-grid" style={rangeGridStyle}>
                      <label><span>Gender</span>
                        <select value={r.gender} onChange={(e) => updateRangeRow(idx, 'gender', e.target.value)}>
                          {GENDER_OPTIONS.map((g) => <option key={g}>{g}</option>)}
                        </select>
                      </label>
                      <label><span>Age From</span>
                        <input type="number" min="0" value={r.ageMin} onChange={(e) => updateRangeRow(idx, 'ageMin', e.target.value)} />
                      </label>
                      <label><span>From Unit</span>
                        <select value={r.ageUnit} onChange={(e) => updateRangeRow(idx, 'ageUnit', e.target.value)}>
                          {AGE_UNIT_OPTIONS.map((u) => <option key={u}>{u}</option>)}
                        </select>
                      </label>
                      <label><span>Age To</span>
                        <input type="number" min="0" value={r.ageMax} onChange={(e) => updateRangeRow(idx, 'ageMax', e.target.value)} />
                      </label>
                      <label><span>To Unit</span>
                        <select value={r.ageMaxUnit} onChange={(e) => updateRangeRow(idx, 'ageMaxUnit', e.target.value)}>
                          {AGE_UNIT_OPTIONS.map((u) => <option key={u}>{u}</option>)}
                        </select>
                      </label>
                      <label><span>Range Low</span>
                        <input value={r.normalRangeLow} onChange={(e) => updateRangeRow(idx, 'normalRangeLow', e.target.value)} />
                      </label>
                      <label><span>Range High</span>
                        <input value={r.normalRangeHigh} onChange={(e) => updateRangeRow(idx, 'normalRangeHigh', e.target.value)} />
                      </label>
                      <label style={{ gridColumn: 'span 2' }}><span>Printed on Report</span>
                        <RangeTextField value={r.rangeText} onChange={(v) => updateRangeRow(idx, 'rangeText', v)} placeholder={r.normalRangeLow || r.normalRangeHigh ? 'Empty = Low - High' : 'e.g. Negative'} />
                      </label>
                      <div className="range-row-actions" style={{ alignSelf: 'end' }}>
                        <button type="button" className="icon-btn danger-icon" title="Remove this range" onClick={() => removeRangeRow(idx)}><Icon name="trash" size={14} /></button>
                      </div>
                    </div>
                  ))}
                  <button type="button" className="secondary" onClick={addRangeRow}>+ Add Age/Gender Range</button>
                  <p style={{ fontSize: 12, color: '#94a3b8', margin: '6px 0 0' }}>
                    Printed on Report: what the report shows as the Normal Range for a patient that row matches - leave
                    empty to print its Range Low - High, or type text such as &quot;Negative&quot;.
                  </p>
                </div>
              )}

              <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
                <button type="submit" disabled={savingParam}>{savingParam ? 'Adding…' : 'Add Parameter'}</button>
                <button type="button" className="secondary" onClick={() => setShowParamModal(false)}>Cancel</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {manageParam && (
        <div className="modal-overlay" onClick={() => setManageParam(null)}>
          <div className="modal-card" style={{ width: 800, maxWidth: 'calc(100vw - 32px)', textAlign: 'left' }} onClick={(e) => e.stopPropagation()}>
            <h2>Normal Ranges — {manageParam.parameterName}</h2>
            <p style={{ fontSize: 13, color: '#64748b' }}>
              Default range: {manageParam.normalRangeLow || '—'} - {manageParam.normalRangeHigh || '—'} (used when no rule below matches).
            </p>
            {!manageParam.clientId && (
              // A universal (Chief Admin) parameter: this clinic either follows
              // Chief Admin's ranges or has its own copy (made on first edit).
              <div className={`range-source ${manageParam.customizedForClient ? 'own' : 'shared'}`}>
                {manageParam.customizedForClient ? (
                  <>
                    <span><strong>Your clinic's ranges.</strong> Chief Admin's later changes to this parameter don't apply to your clinic.</span>
                    <button type="button" className="secondary" onClick={resetToChiefAdmin} disabled={savingRange}>Reset to Chief Admin ranges</button>
                  </>
                ) : (
                  <span><strong>Using Chief Admin's ranges.</strong> Adding, removing or changing a range here makes your clinic's own copy - other clinics are not affected.</span>
                )}
              </div>
            )}
            <table>
              <thead><tr><th>Gender</th><th>Age From</th><th>Age To</th><th>Range</th><th>Printed on Report</th><th></th></tr></thead>
              <tbody>
                {(manageParam.ParameterNormalRanges || []).map((r) => (
                  <RangeRow
                    key={r.id}
                    row={r}
                    genders={GENDER_OPTIONS}
                    ageUnits={AGE_UNIT_OPTIONS}
                    onSave={(changes) => handleUpdateRange(r.id, changes)}
                    onDelete={() => handleDeleteRange(r.id)}
                  />
                ))}
                {(manageParam.ParameterNormalRanges || []).length === 0 && <tr><td colSpan={6}>No age/gender rules yet — the default range applies to everyone.</td></tr>}
              </tbody>
            </table>

            <form onSubmit={handleAddExistingRange} className="form-grid" style={{ ...rangeGridStyle, marginTop: 12 }}>
              <label><span>Gender</span>
                <select value={newRange.gender} onChange={(e) => setNewRange((f) => ({ ...f, gender: e.target.value }))}>
                  {GENDER_OPTIONS.map((g) => <option key={g}>{g}</option>)}
                </select>
              </label>
              <label><span>Age From</span>
                <input type="number" min="0" value={newRange.ageMin} onChange={(e) => setNewRange((f) => ({ ...f, ageMin: e.target.value }))} />
              </label>
              <label><span>From Unit</span>
                <select value={newRange.ageUnit} onChange={(e) => setNewRange((f) => ({ ...f, ageUnit: e.target.value }))}>
                  {AGE_UNIT_OPTIONS.map((u) => <option key={u}>{u}</option>)}
                </select>
              </label>
              <label><span>Age To</span>
                <input type="number" min="0" value={newRange.ageMax} onChange={(e) => setNewRange((f) => ({ ...f, ageMax: e.target.value }))} />
              </label>
              <label><span>To Unit</span>
                <select value={newRange.ageMaxUnit} onChange={(e) => setNewRange((f) => ({ ...f, ageMaxUnit: e.target.value }))}>
                  {AGE_UNIT_OPTIONS.map((u) => <option key={u}>{u}</option>)}
                </select>
              </label>
              <label><span>Range Low</span>
                <input value={newRange.normalRangeLow} onChange={(e) => setNewRange((f) => ({ ...f, normalRangeLow: e.target.value }))} />
              </label>
              <label><span>Range High</span>
                <input value={newRange.normalRangeHigh} onChange={(e) => setNewRange((f) => ({ ...f, normalRangeHigh: e.target.value }))} />
              </label>
              <label style={{ gridColumn: 'span 2' }}><span>Printed on Report</span>
                <RangeTextField value={newRange.rangeText} onChange={(v) => setNewRange((f) => ({ ...f, rangeText: v }))} placeholder={newRange.normalRangeLow || newRange.normalRangeHigh ? 'Empty = Low - High' : 'e.g. Negative'} />
              </label>
              <button type="submit" disabled={savingRange}>{savingRange ? 'Saving…' : 'Save'}</button>
            </form>
            <OldRangeTextNote param={manageParam} onClear={handleClearOldRangeText} />
            {rangeError && <p className="error-text">{rangeError}</p>}
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}>
              <button type="button" onClick={() => setManageParam(null)}>Close</button>
            </div>
          </div>
        </div>
      )}

      <div className="card">
        <h3>Test Short Name</h3>
        <p style={{ fontSize: 13, color: '#64748b' }}>
          Set your own shortcut/abbreviated name for a test — for quick search or a compact report layout. Only
          your lab sees this, just like your test prices.
        </p>
        <form onSubmit={handleSetShortName} className="form-grid" style={{ alignItems: 'end' }}>
          <div><span>Test</span>
            <SearchSelect
              options={tests.map((t) => ({ value: t.id, label: `${t.testCode} — ${t.testName}` }))}
              value={shortNameForm.testId}
              onChange={(testId) => setShortNameForm((f) => ({ ...f, testId }))}
              placeholder="Search by test code or name…"
            />
          </div>
          <label><span>Short Name</span>
            <input value={shortNameForm.shortName} onChange={(e) => setShortNameForm((f) => ({ ...f, shortName: e.target.value }))} required />
          </label>
          <button type="submit" disabled={!shortNameForm.testId}>Set Short Name</button>
        </form>
        <table>
          <thead><tr><th>Test Code</th><th>Test Name</th><th>Short Name</th></tr></thead>
          <tbody>
            {shortNames.map((s) => (
              <tr key={s.id}><td>{s.TestMaster?.testCode}</td><td>{s.TestMaster?.testName}</td><td>{s.shortName}</td></tr>
            ))}
            {shortNames.length === 0 && <tr><td colSpan={3}>No short names set yet.</td></tr>}
          </tbody>
        </table>
      </div>

      <div className="card">
        <h3>Bulk Update — Test Short Names</h3>
        <p style={{ fontSize: 13, color: '#64748b' }}>Columns: TEST_CODE, TEST_NAME, SHORT_NAME</p>
        <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
          <button type="button" className="secondary" onClick={() => downloadFile('/test-config/test-shortname/template', 'test-shortname-template.xlsx')}>
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
              <thead><tr><th>Row</th><th>Test Code</th><th>Short Name</th><th>Status</th></tr></thead>
              <tbody>
                {bulkPreview.preview.map((r) => (
                  <tr key={r.row}>
                    <td>{r.row}</td><td>{r.testCode}</td><td>{r.shortName}</td>
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
    </div>
  );
}

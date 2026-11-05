import { useEffect, useMemo, useState } from 'react';
import api from '../../api/client';
import { RemarksContent, parseRemarksTable } from '../../components/Remarks';
import Sparkline from '../../components/Sparkline';

// 'H' above the normal range, 'L' below it, null when in range or not numeric.
function rangeFlag(value, low, high) {
  const v = Number(value);
  if (value === '' || value == null || Number.isNaN(v) || low == null || high == null) return null;
  const l = Number(low);
  const h = Number(high);
  if (Number.isNaN(l) || Number.isNaN(h)) return null;
  if (v > h) return 'H';
  if (v < l) return 'L';
  return null;
}

function formatShortDate(iso) {
  return iso ? new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: '2-digit' }) : '';
}

// Delta check: change from this patient's previous released value of the same
// parameter. null when either side isn't a number.
function deltaOf(current, previous) {
  const c = Number(current);
  const p = Number(previous);
  if (current === '' || current == null || previous == null || previous === '' || Number.isNaN(c) || Number.isNaN(p)) return null;
  const diff = c - p;
  return { diff, pct: p !== 0 ? (diff / Math.abs(p)) * 100 : null };
}

// Shared column widths: the heading row is drawn once at the top and every
// test's table reuses these, so all of them line up under that one heading.
function ResultCols() {
  return (
    <colgroup>
      <col style={{ width: '32%' }} /><col style={{ width: '26%' }} /><col style={{ width: '17%' }} />
      <col style={{ width: '11%' }} /><col style={{ width: '14%' }} />
    </colgroup>
  );
}

function formatNumber(n) {
  return Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/\.?0+$/, '');
}

function paramsFor(sample) {
  return sample.BillItem?.TestMaster?.ParameterMasters || [];
}

// Interpretation parameters are free-text commentary, not a measured result -
// leaving one blank shouldn't block a test from counting as complete and
// auto-verifying on save.
function requiredParamsFor(sample) {
  return paramsFor(sample).filter((p) => !p.isInterpretation);
}

function testNameOf(sample) {
  return sample.BillItem?.TestMaster?.testName || 'Test';
}

function initialValuesFor(sample) {
  const values = {};
  for (const r of sample.Results || []) values[r.parameterId] = r.value;
  return values;
}

function formatAge(age, ageUnit) {
  if (age == null || age === '') return '';
  if (ageUnit === 'Months') return `${age}mo`;
  if (ageUnit === 'Days') return `${age}d`;
  return `${age}y`;
}

/**
 * Full-screen result entry + review/verify panel for one bill's tests -
 * the same screen opens whichever of "Results" or "Verify" was clicked on a
 * test, since both are really "look at this test's values and confirm them".
 */
export default function ReviewResults({ group, focusSampleId, onClose, onSaved }) {
  const eligibleSamples = useMemo(
    () => group.samples.filter((s) => ['COLLECTED', 'RESULT_ENTERED', 'VERIFIED'].includes(s.status)),
    [group],
  );

  const [values, setValues] = useState(() => {
    const v = {};
    for (const s of eligibleSamples) v[s.id] = initialValuesFor(s);
    return v;
  });
  const [savedValues] = useState(() => {
    const v = {};
    for (const s of eligibleSamples) v[s.id] = initialValuesFor(s);
    return v;
  });
  const [checked, setChecked] = useState(() => {
    const set = new Set();
    for (const s of eligibleSamples) {
      // Pre-check every test that already has at least one value entered.
      const anyEntered = requiredParamsFor(s).some((p) => (initialValuesFor(s)[p.id] || '').toString().trim() !== '');
      if (anyEntered) set.add(s.id);
    }
    // Whichever test "Results"/"Verify" was clicked on should already be
    // showing when the screen opens, not require an extra click to check it.
    if (focusSampleId && eligibleSamples.some((s) => s.id === focusSampleId)) set.add(focusSampleId);
    return set;
  });
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState(''); // '' | 'saving' | 'verifying' | 'releasing' - drives the footer button's label while busy
  const [error, setError] = useState('');
  const [previous, setPrevious] = useState({}); // parameterId -> { value, date, isAbnormal, billNo }
  // Per-test remarks: sampleId -> { text, big }. "big" = the large multi-line
  // box (interpretation / pasted table) instead of the one-line box.
  const [remarks, setRemarks] = useState(() => Object.fromEntries(
    eligibleSamples.map((s) => [s.id, { text: s.remarks || '', big: !!s.remarksBig }]),
  ));
  const [savedRemarks] = useState(() => Object.fromEntries(
    eligibleSamples.map((s) => [s.id, s.remarks || '']),
  ));

  function setRemarkText(sampleId, text) {
    setRemarks((r) => ({ ...r, [sampleId]: { ...r[sampleId], text } }));
  }
  function setRemarkBig(sampleId, big) {
    setRemarks((r) => ({ ...r, [sampleId]: { ...r[sampleId], big } }));
  }

  useEffect(() => {
    api.get(`/lab/bills/${group.billId}/previous-results`)
      .then(({ data }) => setPrevious(data || {}))
      .catch(() => {}); // delta is a nice-to-have - entry works without it
  }, [group.billId]);

  function enteredCount(sample) {
    const params = requiredParamsFor(sample);
    const vals = values[sample.id] || {};
    const filled = params.filter((p) => (vals[p.id] || '').toString().trim() !== '').length;
    return { filled, total: params.length };
  }

  function setValue(sampleId, parameterId, value) {
    setValues((v) => ({ ...v, [sampleId]: { ...v[sampleId], [parameterId]: value } }));
  }

  function toggleChecked(sampleId) {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(sampleId)) next.delete(sampleId); else next.add(sampleId);
      return next;
    });
  }

  function toggleSelectAll() {
    setChecked((prev) => (prev.size === eligibleSamples.length ? new Set() : new Set(eligibleSamples.map((s) => s.id))));
  }

  const checkedSamples = eligibleSamples.filter((s) => checked.has(s.id));
  // Parameters are NOT mandatory: a test with 10 parameters can be verified
  // and released with only the ones actually done filled in - empty ones are
  // simply left off the report. A test only needs at least one value (or a
  // remark, for an interpretation-only test) to count as ready.
  function isComplete(s) {
    const c = enteredCount(s);
    if (c.total === 0) return true; // interpretation-only test
    return c.filled > 0;
  }
  function missingParams(s) {
    return requiredParamsFor(s).filter((p) => (values[s.id]?.[p.id] || '').toString().trim() === '');
  }
  // Each checked test is judged on its own: a ready one gets verified even
  // when another checked test has nothing entered yet.
  const readySamples = checkedSamples.filter(isComplete);
  const incompleteSamples = checkedSamples.filter((s) => !isComplete(s));
  const allCheckedReady = checkedSamples.length > 0 && incompleteSamples.length === 0;
  // Editing results that were already VERIFIED (opened via "Edit Results" on
  // a report pending/awaiting release) is a correction, not first-time entry -
  // saving re-verifies and re-releases it in one step instead of requiring a
  // separate trip through Verify and then the main screen's Release action.
  const allCheckedWereVerified = checkedSamples.length > 0 && checkedSamples.every((s) => s.status === 'VERIFIED');

  async function handleSubmit() {
    if (busy || checkedSamples.length === 0) return;
    setBusy(true);
    setError('');
    try {
      // Every checked sample's call runs in parallel instead of one-by-one -
      // with several tests checked, awaiting each sample's save/verify/release
      // in sequence could take several seconds and look stuck with no
      // feedback. The stage label below keeps the button honest about what's
      // still happening while it works.
      setStage('saving');
      await Promise.all(checkedSamples.map((s) => {
        const params = paramsFor(s);
        const results = params.map((p) => ({ parameterId: p.id, value: (values[s.id]?.[p.id] || '').toString() }));
        const remark = remarks[s.id] || { text: '', big: false };
        return api.post(`/lab/samples/${s.id}/results`, { results, remarks: remark.text, remarksBig: remark.big });
      }));

      // Saving above moved every checked sample to RESULT_ENTERED - including
      // any that were already VERIFIED - so every complete one is verified
      // again here, or it would silently drop out of the release step.
      const failed = [];
      if (readySamples.length > 0) {
        setStage('verifying');
        await Promise.all(readySamples.map((s) => api.post(`/lab/samples/${s.id}/verify`)
          .catch((err) => { failed.push(`${testNameOf(s)}: ${err.response?.data?.message || 'could not verify'}`); })));
        if (allCheckedReady && allCheckedWereVerified && failed.length === 0) {
          setStage('releasing');
          await Promise.all(readySamples.map((s) => api.post(`/lab/samples/${s.id}/release`)
            .catch((err) => { failed.push(`${testNameOf(s)}: ${err.response?.data?.message || 'could not release'}`); })));
        }
      }

      // Tell the main screen what happened, so nothing is silently left behind.
      const notes = [];
      if (incompleteSamples.length > 0) {
        notes.push(`Saved but NOT verified - no result entered yet for: ${incompleteSamples.map(testNameOf).join(', ')}.`);
      }
      if (failed.length > 0) notes.push(failed.join(' · '));
      onSaved(notes.length ? { notice: notes.join(' ') } : undefined);
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to save');
    } finally {
      setStage('');
      setBusy(false);
    }
  }

  function hasChanges(sample) {
    if ((remarks[sample.id]?.text || '') !== (savedRemarks[sample.id] || '')) return true;
    return paramsFor(sample).some(
      (p) => (values[sample.id]?.[p.id] || '') !== (savedValues[sample.id]?.[p.id] || ''),
    );
  }

  return (
    <div className="review-screen">
      <div className="review-header">
        <strong>Review Results</strong>
        <span className="dot">•</span>
        <span className="meta">#{`LAB${String(group.billId).padStart(5, '0')}`}</span>
        <span className="dot">•</span>
        <span className="meta">{group.billNo}</span>
        <span className="dot">•</span>
        <span className="meta">{group.patient?.name}</span>
        {(group.patient?.age || group.patient?.gender) && (
          <>
            <span className="dot">•</span>
            <span className="meta">
              {formatAge(group.patient?.age, group.patient?.ageUnit)}
              {group.patient?.age && group.patient?.gender ? ' / ' : ''}
              {group.patient?.gender}
            </span>
          </>
        )}
        <button className="close-btn" onClick={onClose} aria-label="Close">×</button>
      </div>

      <div className="review-body">
        <div className="review-sidebar">
          <div className="review-select-all" onClick={toggleSelectAll} style={{ cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={checked.size === eligibleSamples.length && eligibleSamples.length > 0}
              ref={(el) => { if (el) el.indeterminate = checked.size > 0 && checked.size < eligibleSamples.length; }}
              onChange={toggleSelectAll}
              onClick={(e) => e.stopPropagation()}
            />
            <span>Select All</span>
            <span className="count">{checked.size}/{eligibleSamples.length}</span>
          </div>

          {eligibleSamples.map((s) => {
            const c = enteredCount(s);
            const complete = c.filled === c.total;
            const isChecked = checked.has(s.id);
            return (
              <div
                key={s.id}
                className={`review-test-row${isChecked ? ' active' : ''}`}
                onClick={() => toggleChecked(s.id)}
              >
                <input
                  type="checkbox"
                  checked={isChecked}
                  onChange={() => toggleChecked(s.id)}
                  onClick={(e) => e.stopPropagation()}
                  style={{ marginTop: 2 }}
                />
                <div>
                  <div className="name">{s.BillItem?.TestMaster?.testName}</div>
                  <span className={`count-pill${complete ? ' complete' : ''}`}>{c.filled} / {c.total}</span>
                </div>
              </div>
            );
          })}
        </div>

        <div className="review-main">
          {error && <p className="error-text">{error}</p>}

          {checkedSamples.length === 0 && (
            <p className="masters-empty">Check a test on the left to enter or review its results.</p>
          )}

          {checkedSamples.some((s) => paramsFor(s).some((p) => !p.isInterpretation)) && (
            <div className="result-head-wrap">
              <table className="result-table">
                <ResultCols />
                <thead>
                  <tr><th>Parameter</th><th>Result</th><th>Normal range</th><th>Previous</th><th>Delta</th></tr>
                </thead>
              </table>
            </div>
          )}

          {checkedSamples.map((sample) => {
            const count = enteredCount(sample);
            return (
              <div key={sample.id} className="review-section">
                <div className="review-main-header">
                  <h2>{sample.BillItem?.TestMaster?.testName}</h2>
                  {hasChanges(sample) && <span className="review-badge delta" title="Values changed since last save">Edited</span>}
                  <span className={`review-badge entered${count.filled === count.total ? '' : ' partial'}`}>
                    {count.filled} / {count.total} Entered
                  </span>
                  {count.filled === 0 && count.total > 0 && (
                    <span className="review-badge missing" title="Enter at least one result to verify and release this test">
                      No result entered yet
                    </span>
                  )}
                  {count.filled > 0 && count.filled < count.total && (
                    <span className="review-badge skipped" title="Optional - parameters left empty are simply not printed on the report">
                      Not entered (won&apos;t print): {missingParams(sample).map((p) => p.parameterName).join(', ')}
                    </span>
                  )}
                </div>

                {paramsFor(sample).some((p) => !p.isInterpretation) && (
                  <table className="result-table">
                    <ResultCols />
                    <tbody>
                      {paramsFor(sample).filter((p) => !p.isInterpretation).map((p) => {
                        const value = values[sample.id]?.[p.id] || '';
                        const flag = rangeFlag(value, p.normalRangeLow, p.normalRangeHigh);
                        const prev = previous[p.id];
                        const delta = deltaOf(value, prev?.value);
                        const hasRange = p.normalRangeLow != null && p.normalRangeLow !== '' && p.normalRangeHigh != null && p.normalRangeHigh !== '';
                        return (
                          <tr key={p.id} className={flag ? 'abnormal-row' : ''}>
                            <td className="rt-param">
                              {p.parameterCode && <span className="rt-code">{p.parameterCode}</span>}
                              {p.parameterName}
                            </td>
                            <td className="rt-result">
                              <div className="rt-input">
                                <input
                                  className={flag ? 'abnormal' : ''}
                                  value={value}
                                  onChange={(e) => setValue(sample.id, p.id, e.target.value)}
                                  aria-label={`${p.parameterName} result`}
                                />
                                <span className="rt-unit">{p.unit}</span>
                                {flag && <span className={`rt-flag ${flag}`} title={flag === 'H' ? 'Above normal range' : 'Below normal range'}>{flag === 'H' ? '▲ H' : '▼ L'}</span>}
                              </div>
                            </td>
                            <td className="rt-range" data-label="Normal">{p.normalRangeText?.trim() ? <span style={{ whiteSpace: 'pre-wrap' }}>{p.normalRangeText}</span> : (hasRange ? `${p.normalRangeLow} – ${p.normalRangeHigh}` : '—')}{!p.normalRangeText?.trim() && hasRange && p.unit ? <span className="rt-unit"> {p.unit}</span> : null}</td>
                            <td className="rt-prev" data-label="Previous">
                              {prev ? (
                                <>
                                  <span className={prev.isAbnormal ? 'prev-abnormal' : ''}>{prev.value}</span>
                                  <span className="rt-date" title={prev.billNo}>{formatShortDate(prev.date)}</span>
                                  {/* Every earlier visit, oldest first - shown for every parameter
                                      (the report's Trend tick box only affects the printed report). */}
                                  {prev.history?.length > 1 && (
                                    <span
                                      className="rt-trend"
                                      title={prev.history.map((h) => `${formatShortDate(h.date)}: ${h.value}${h.billNo ? ` (${h.billNo})` : ''}`).join('\n')}
                                    >
                                      <Sparkline points={prev.history} width={64} height={18} />
                                      <small>{prev.history.length} visits</small>
                                    </span>
                                  )}
                                </>
                              ) : <span className="rt-none">—</span>}
                            </td>
                            <td className="rt-delta" data-label="Delta">
                              {delta ? (
                                <span className={`delta-pill ${delta.diff > 0 ? 'up' : delta.diff < 0 ? 'down' : 'same'}`}>
                                  {delta.diff > 0 ? '▲' : delta.diff < 0 ? '▼' : '='} {formatNumber(Math.abs(delta.diff))}
                                  {delta.pct != null && delta.diff !== 0 && <small> ({delta.pct > 0 ? '+' : '−'}{Math.abs(delta.pct).toFixed(0)}%)</small>}
                                </span>
                              ) : <span className="rt-none">—</span>}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}

                {paramsFor(sample).filter((p) => p.isInterpretation).map((p) => (
                  <div className="review-interpretation-card" key={p.id}>
                    <div className="p-name">{p.parameterCode ? `[${p.parameterCode}] ` : ''}{p.parameterName}</div>
                    <textarea
                      rows={3}
                      value={values[sample.id]?.[p.id] || ''}
                      onChange={(e) => setValue(sample.id, p.id, e.target.value)}
                      placeholder="Enter interpretation / findings…"
                    />
                  </div>
                ))}

                <div className={`remarks-box${remarks[sample.id]?.big ? ' big' : ''}`}>
                  <div className="remarks-box-head">
                    <span className="remarks-label">Remarks <small>(optional · printed on the report)</small></span>
                    <div className="remarks-size" role="group" aria-label="Remarks box size">
                      <button
                        type="button"
                        className={!remarks[sample.id]?.big ? 'on' : ''}
                        onClick={() => setRemarkBig(sample.id, false)}
                        // A one-line box would silently drop line breaks (and break a table).
                        disabled={(remarks[sample.id]?.text || '').includes('\n')}
                        title={(remarks[sample.id]?.text || '').includes('\n') ? 'Remarks have several lines - keep the Big box' : 'One-line box'}
                      >
                        Small
                      </button>
                      <button type="button" className={remarks[sample.id]?.big ? 'on' : ''} onClick={() => setRemarkBig(sample.id, true)}>Big</button>
                    </div>
                  </div>
                  {remarks[sample.id]?.big ? (
                    <>
                      <textarea
                        rows={5}
                        value={remarks[sample.id]?.text || ''}
                        onChange={(e) => setRemarkText(sample.id, e.target.value)}
                        placeholder={'Interpretation / comments…\nFor a table, paste it from Excel, or type columns separated by |  e.g.\nAntibiotic | Result\nAmikacin | Sensitive'}
                      />
                      {parseRemarksTable(remarks[sample.id]?.text) && (
                        <div className="remarks-preview">
                          <span className="remarks-preview-label">Table preview (as on report)</span>
                          <RemarksContent text={remarks[sample.id].text} />
                        </div>
                      )}
                    </>
                  ) : (
                    <input
                      value={remarks[sample.id]?.text || ''}
                      onChange={(e) => setRemarkText(sample.id, e.target.value)}
                      placeholder="e.g. Sample slightly haemolysed - repeat advised"
                    />
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="review-footer">
        <span className="checked-count">{checkedSamples.length} of {eligibleSamples.length} test(s) checked</span>
        <button onClick={handleSubmit} disabled={busy || checkedSamples.length === 0}>
          {busy
            ? { saving: 'Saving…', verifying: 'Verifying…', releasing: 'Releasing…' }[stage] || 'Saving…'
            : allCheckedReady
              ? (allCheckedWereVerified
                ? `Release ${checkedSamples.length} Test${checkedSamples.length === 1 ? '' : 's'}`
                : `Mark Reviewed ${checkedSamples.length} Test${checkedSamples.length === 1 ? '' : 's'}`)
              : readySamples.length > 0
                ? `Save & Verify ${readySamples.length} of ${checkedSamples.length}`
                : `Save Results (${checkedSamples.length})`}
        </button>
      </div>
    </div>
  );
}

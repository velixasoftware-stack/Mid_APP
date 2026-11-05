// The "Normal Range (as printed)" boxes on parameter forms - gender-wise:
// Male, Female and Common. A male/female patient's report prints its own
// box (falling back to Common when that box is empty); anyone else gets
// Common. Each box fills itself from the ranges entered - Male from the Male
// age/gender rows, Female from the Female rows, Common from the default
// Range Low/High and the "All" rows - one line per age band. Once a box is
// edited by hand it stops auto-filling (clearing it turns auto-fill back
// on). Any box can also be typed on its own, e.g. "Negative".
import { useEffect, useState } from 'react';
import api from '../api/client';
import { Icon } from './Icons';

function pair(low, high) {
  const l = (low ?? '').toString().trim();
  const h = (high ?? '').toString().trim();
  if (l && h) return `${l} - ${h}`;
  if (l) return `> ${l}`;
  if (h) return `< ${h}`;
  return '';
}

const blank = (v) => v === '' || v == null;
function ageBand(r) {
  if (blank(r.ageMin) && blank(r.ageMax)) return '';
  const from = r.ageUnit || 'Years';
  const to = r.ageMaxUnit || from;
  if (to === from) return `${blank(r.ageMin) ? 0 : r.ageMin}-${blank(r.ageMax) ? '∞' : r.ageMax} ${from}`;
  return `${blank(r.ageMin) ? 0 : r.ageMin} ${from} - ${blank(r.ageMax) ? '∞' : r.ageMax} ${to}`;
}

function rowLines(rows, keep, withGender = false) {
  return rows
    .filter(keep)
    .map((r) => {
      const range = pair(r.normalRangeLow, r.normalRangeHigh);
      if (!range) return null;
      const who = [withGender && r.gender && !['All', 'Any'].includes(r.gender) ? r.gender : '', ageBand(r)].filter(Boolean).join(' ');
      return who ? `${who}: ${range}` : range;
    })
    .filter(Boolean);
}

/** { common, male, female } texts from the default low/high and the range rows. */
export function autoRangeTexts(low, high, rows = []) {
  const g = (r) => (r.gender || 'All');
  const male = rowLines(rows, (r) => g(r) === 'Male').join('\n');
  const female = rowLines(rows, (r) => g(r) === 'Female').join('\n');
  const others = rowLines(rows, (r) => g(r) !== 'Male' && g(r) !== 'Female', true);
  const base = pair(low, high);
  const common = [base && others.length ? `Default: ${base}` : base, ...others].filter(Boolean).join('\n');
  return { common, male, female };
}

const FIELDS = [
  { key: 'normalRangeTextMale', auto: 'male', edited: 'rangeTextMaleEdited', label: 'Male' },
  { key: 'normalRangeTextFemale', auto: 'female', edited: 'rangeTextFemaleEdited', label: 'Female' },
  { key: 'normalRangeText', auto: 'common', edited: 'rangeTextEdited', label: 'Common (all / other)' },
];

/** Blank form fields for the three boxes. */
export const blankRangeTexts = () => ({
  normalRangeText: '', normalRangeTextMale: '', normalRangeTextFemale: '',
  rangeTextEdited: false, rangeTextMaleEdited: false, rangeTextFemaleEdited: false,
});

/** Keeps each box filled from its ranges until that box is edited by hand. */
export function useAutoRangeText(form, setForm, low, high, rows) {
  const auto = autoRangeTexts(low, high, rows);
  const sig = `${auto.common}\u0000${auto.male}\u0000${auto.female}`;
  useEffect(() => {
    setForm((f) => {
      let next = f;
      for (const fld of FIELDS) {
        if (!f[fld.edited] && f[fld.key] !== auto[fld.auto]) next = { ...next, [fld.key]: auto[fld.auto] };
      }
      return next;
    });
  }, [sig, form.rangeTextEdited, form.rangeTextMaleEdited, form.rangeTextFemaleEdited]); // eslint-disable-line react-hooks/exhaustive-deps
}

function RangeBox({ label, value, onChange, placeholder }) {
  return (
    <label style={{ display: 'block', margin: 0 }}>
      <span>{label}</span>
      <textarea rows={3} value={value || ''} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />
    </label>
  );
}

/** The three boxes for a parameter form; typing marks a box edited, clearing resumes auto-fill. */
export default function NormalRangeTextBoxes({ form, setForm }) {
  return (
    <div style={{ marginTop: 10 }}>
      <span style={{ fontWeight: 600, fontSize: 13 }}>Normal Range (as printed on the report)</span>
      <p style={{ fontSize: 12, color: '#94a3b8', margin: '2px 0 6px' }}>
        A male/female patient's report prints their own box; anyone else (or an empty box) gets Common.
        Fills from the ranges above, or type directly - e.g. "Negative".
      </p>
      <div className="range-text-grid">
        {FIELDS.map((fld) => (
          <RangeBox
            key={fld.key}
            label={fld.label}
            value={form[fld.key]}
            placeholder={fld.auto === 'common' ? 'e.g. 70 - 110 or Negative' : `Printed for ${fld.label.toLowerCase()} patients`}
            onChange={(v) => setForm((f) => ({ ...f, [fld.key]: v, [fld.edited]: v.trim() !== '' }))}
          />
        ))}
      </div>
    </div>
  );
}

/** The reference range to show for a result row: the printed text if set, else low - high. */
export function rangeLabel(p) {
  if (p.normalRangeText && p.normalRangeText.trim()) return p.normalRangeText;
  const hasRange = p.normalRangeLow != null && p.normalRangeLow !== '' && p.normalRangeHigh != null && p.normalRangeHigh !== '';
  return hasRange ? `${p.normalRangeLow} - ${p.normalRangeHigh}` : '';
}

/**
 * Manage ranges dialog: the three boxes' draft for an existing parameter.
 * Starts from the saved text; a box with nothing saved yet fills itself from
 * the saved ranges plus the range being typed (newRange), until edited.
 */
export function useManageRangeDraft(param, newRange) {
  const init = () => ({
    normalRangeText: param.normalRangeText || '',
    normalRangeTextMale: param.normalRangeTextMale || '',
    normalRangeTextFemale: param.normalRangeTextFemale || '',
    rangeTextEdited: !!param.normalRangeText,
    rangeTextMaleEdited: !!param.normalRangeTextMale,
    rangeTextFemaleEdited: !!param.normalRangeTextFemale,
  });
  const [draft, setDraft] = useState(init);
  useEffect(() => { setDraft(init()); }, [param.id, param.normalRangeText, param.normalRangeTextMale, param.normalRangeTextFemale]); // eslint-disable-line react-hooks/exhaustive-deps
  const typing = newRange && (newRange.normalRangeLow || newRange.normalRangeHigh) ? [newRange] : [];
  useAutoRangeText(draft, setDraft, param.normalRangeLow, param.normalRangeHigh, [...(param.ParameterNormalRanges || []), ...typing]);
  return [draft, setDraft];
}

/** Whether the draft differs from what's saved on the parameter. */
export function rangeTextsChanged(param, draft) {
  return FIELDS.some((f) => (draft[f.key] || '').trim() !== (param[f.key] || '').trim());
}

/** Save the three boxes for an existing parameter. */
export function saveRangeTexts(apiBase, paramId, draft) {
  return api.put(`${apiBase}/parameters/${paramId}/normal-range-text`, {
    normalRangeText: draft.normalRangeText, normalRangeTextMale: draft.normalRangeTextMale, normalRangeTextFemale: draft.normalRangeTextFemale,
  });
}

/** Read-only view of a universal parameter's printed ranges (seen from a client). */
export function RangeTextsReadOnly({ param }) {
  return (
    <div style={{ fontSize: 13, color: '#64748b', gridColumn: '1 / -1' }}>
      Printed on report (universal parameter - set by Chief Admin):
      {FIELDS.map((fld) => (
        <div key={fld.key} style={{ whiteSpace: 'pre-wrap' }}><strong>{fld.label}:</strong> {param[fld.key] || '—'}</div>
      ))}
    </div>
  );
}

/**
 * "Printed on Report" text with a Small / Big switch (like Remarks): Small is
 * one line, Big a multi-line box for longer text. Text with line breaks
 * opens Big. Empty = the row's own low - high is printed.
 */
export function RangeTextField({ value, onChange, placeholder, autoFocus }) {
  const [big, setBig] = useState(() => (value || '').includes('\n'));
  const multiLine = (value || '').includes('\n');
  return (
    <div className="range-text-field">
      <div className="remarks-size" role="group" aria-label="Box size">
        <button type="button" className={big ? '' : 'on'} onClick={() => setBig(false)} disabled={multiLine} title={multiLine ? 'Has more than one line - keep the big box' : 'One line'}>Small</button>
        <button type="button" className={big ? 'on' : ''} onClick={() => setBig(true)} title="Several lines">Big</button>
      </div>
      {big ? (
        <textarea rows={3} value={value || ''} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} autoFocus={autoFocus} />
      ) : (
        <input value={value || ''} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} autoFocus={autoFocus} />
      )}
    </div>
  );
}

/**
 * One saved age/gender range row in the Normal Ranges dialog: shown as
 * text, with small Edit / Delete icons; Edit turns the row into inputs
 * (including its Printed on Report text) with Save / Cancel.
 * onSave(changes) and onDelete() return promises.
 */
export function RangeRow({ row, genders, ageUnits, onSave, onDelete }) {
  const toDraft = () => ({
    gender: row.gender === 'Any' ? 'All' : (row.gender || 'All'), ageMin: row.ageMin ?? '', ageMax: row.ageMax ?? '', ageUnit: row.ageUnit || 'Years',
    ageMaxUnit: row.ageMaxUnit || row.ageUnit || 'Years',
    normalRangeLow: row.normalRangeLow ?? '', normalRangeHigh: row.normalRangeHigh ?? '', rangeText: row.rangeText || '',
  });
  const [draft, setDraft] = useState(null); // null = not editing
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setDraft((d) => ({ ...d, [k]: e.target ? e.target.value : e }));

  async function save() {
    setBusy(true);
    try { await onSave(draft); setDraft(null); } catch { /* the dialog shows the error */ } finally { setBusy(false); }
  }
  async function remove() {
    if (!window.confirm('Delete this range row?')) return;
    setBusy(true);
    try { await onDelete(); } finally { setBusy(false); }
  }

  if (!draft) {
    const range = pair(row.normalRangeLow, row.normalRangeHigh);
    return (
      <tr>
        <td>{row.gender}</td>
        <td>{row.ageMin != null ? `${row.ageMin} ${row.ageUnit || 'Years'}` : '—'}</td>
        <td>{row.ageMax != null ? `${row.ageMax} ${row.ageMaxUnit || row.ageUnit || 'Years'}` : '—'}</td>
        <td>{range || '—'}</td>
        <td style={{ whiteSpace: 'pre-wrap' }}>
          {row.rangeText ? row.rangeText : <span style={{ color: '#94a3b8' }}>{range || '—'}</span>}
        </td>
        <td>
          <div className="range-row-actions">
            <button type="button" className="icon-btn" title="Edit this range" onClick={() => setDraft(toDraft())} disabled={busy}><Icon name="edit" size={14} /></button>
            <button type="button" className="icon-btn danger-icon" title="Delete this range" onClick={remove} disabled={busy}><Icon name="trash" size={14} /></button>
          </div>
        </td>
      </tr>
    );
  }

  return (
    <tr className="range-row-editing">
      <td><select value={draft.gender} onChange={set('gender')}>{genders.map((g) => <option key={g}>{g}</option>)}</select></td>
      <td>
        <div className="range-age-cell">
          <input type="number" min="0" value={draft.ageMin} onChange={set('ageMin')} />
          <select value={draft.ageUnit} onChange={set('ageUnit')}>{ageUnits.map((u) => <option key={u}>{u}</option>)}</select>
        </div>
      </td>
      <td>
        <div className="range-age-cell">
          <input type="number" min="0" value={draft.ageMax} onChange={set('ageMax')} />
          <select value={draft.ageMaxUnit} onChange={set('ageMaxUnit')}>{ageUnits.map((u) => <option key={u}>{u}</option>)}</select>
        </div>
      </td>
      <td>
        <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
          <input value={draft.normalRangeLow} onChange={set('normalRangeLow')} placeholder="Low" style={{ width: 54 }} />
          <span>-</span>
          <input value={draft.normalRangeHigh} onChange={set('normalRangeHigh')} placeholder="High" style={{ width: 54 }} />
        </div>
      </td>
      <td>
        <RangeTextField
          value={draft.rangeText}
          onChange={set('rangeText')}
          placeholder={pair(draft.normalRangeLow, draft.normalRangeHigh) || 'e.g. Negative'}
        />
      </td>
      <td>
        <div className="range-row-actions">
          <button type="button" className="icon-btn ok-icon" title="Save" onClick={save} disabled={busy}><Icon name="check" size={14} /></button>
          <button type="button" className="icon-btn" title="Cancel" onClick={() => setDraft(null)} disabled={busy}><Icon name="close" size={14} /></button>
        </div>
      </td>
    </tr>
  );
}

/**
 * The parameter-level printed text from before per-row text existed. It's
 * now only used for a patient no range row matches - shown so it isn't a
 * hidden surprise, with a way to clear it.
 */
export function OldRangeTextNote({ param, onClear, disabled }) {
  const texts = FIELDS.filter((f) => (param[f.key] || '').trim());
  if (texts.length === 0) return null;
  return (
    <div style={{ fontSize: 12, color: '#64748b', margin: '10px 0 0', padding: '8px 10px', background: '#f8fafc', borderRadius: 6 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
        <strong>Older printed text - used only when no row above matches the patient:</strong>
        {onClear && <button type="button" className="secondary" style={{ padding: '2px 10px' }} onClick={onClear} disabled={disabled}>Clear</button>}
      </div>
      {texts.map((f) => (
        <div key={f.key} style={{ whiteSpace: 'pre-wrap' }}>{f.label}: {param[f.key]}</div>
      ))}
    </div>
  );
}

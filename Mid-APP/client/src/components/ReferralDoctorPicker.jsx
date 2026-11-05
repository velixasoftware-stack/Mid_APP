import { useEffect, useRef, useState } from 'react';
import api from '../api/client';

function initials(name) {
  return name.replace(/^dr\.?\s*/i, '').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('') || 'DR';
}

/**
 * Optional "Referral" field on the billing page, laid out like the fields
 * beside it. Whatever is typed is the referring doctor (blank = no
 * referral). While typing it suggests this clinic's saved doctors (most
 * recently used first); a name not saved yet is saved against the clinic
 * when the bill is generated (findOrCreateDoctor on the server), so it's
 * suggested from the next bill on.
 */
export default function ReferralDoctorPicker({ value, onChange }) {
  const [doctors, setDoctors] = useState([]);
  const [open, setOpen] = useState(false);
  const boxRef = useRef(null);

  const typed = (value || '').trim();

  // Server-side search, so a clinic with many saved doctors still finds all of them.
  useEffect(() => {
    if (!open) return undefined;
    const timer = setTimeout(() => {
      api.get('/doctors', { params: typed ? { search: typed } : {} })
        .then((r) => setDoctors(r.data))
        .catch(() => setDoctors([]));
    }, 200);
    return () => clearTimeout(timer);
  }, [typed, open]);

  useEffect(() => {
    function handleClickOutside(e) {
      if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const exact = doctors.find((d) => d.name.toLowerCase() === typed.toLowerCase());
  const suggestions = exact ? doctors.filter((d) => d !== exact) : doctors;

  return (
    <div className="referral-field" ref={boxRef}>
      <span>Referral <small className="referral-optional">(optional)</small></span>
      <div className="referral-input">
        <span className="referral-input-icon" aria-hidden="true">{typed ? initials(typed) : 'Dr'}</span>
        <input
          value={value}
          onChange={(e) => { onChange(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === 'Escape') { e.preventDefault(); setOpen(false); } }}
          placeholder="Doctor's name"
        />
        {typed && (
          <button type="button" className="referral-clear" aria-label="Clear referral" onClick={() => { onChange(''); setOpen(false); }}>×</button>
        )}
      </div>
      {typed && !exact && !open && <small className="referral-hint">New doctor - will be saved</small>}

      {open && (suggestions.length > 0 || (typed && !exact)) && (
        <div className="referral-results">
          {suggestions.map((d) => (
            <button type="button" key={d.id} className="referral-option" onClick={() => { onChange(d.name); setOpen(false); }}>
              <span className="referral-avatar">{initials(d.name)}</span>
              <span>{d.name}{d.mobile && <small> · {d.mobile}</small>}</span>
            </button>
          ))}
          {typed && !exact && (
            <button type="button" className="referral-option add-new" onClick={() => setOpen(false)}>
              <span className="referral-avatar">+</span>
              <span>Add new doctor “{typed}”</span>
            </button>
          )}
        </div>
      )}
    </div>
  );
}

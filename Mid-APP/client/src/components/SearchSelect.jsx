import { useEffect, useRef, useState } from 'react';

/**
 * A type-to-filter picker for choosing one item out of a long list (e.g. 100+
 * tests) - searching by typing is far faster than scrolling a native
 * <select>, which is the whole point of this component.
 * `options`: [{ value, label, sublabel? }]
 */
export default function SearchSelect({ options, value, onChange, placeholder = 'Search…' }) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);

  const selected = options.find((o) => String(o.value) === String(value));

  useEffect(() => {
    function handleClickOutside(e) {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const filtered = query
    ? options.filter((o) => `${o.label} ${o.sublabel || ''}`.toLowerCase().includes(query.toLowerCase()))
    : options;

  function selectOption(opt) {
    onChange(opt.value);
    setQuery('');
    setOpen(false);
  }

  function clearSelection() {
    onChange('');
    setQuery('');
  }

  return (
    <div className="search-select" ref={wrapRef}>
      {selected && !open ? (
        <div className="search-select-chosen" onClick={() => setOpen(true)}>
          <span>{selected.label}</span>
          <button type="button" className="secondary" onClick={(e) => { e.stopPropagation(); clearSelection(); }}>Change</button>
        </div>
      ) : (
        <input
          value={query}
          onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          placeholder={placeholder}
        />
      )}
      {open && (
        <div className="search-select-results">
          {filtered.slice(0, 50).map((o) => (
            <div key={o.value} className="search-select-item" onClick={() => selectOption(o)}>
              {o.label}
            </div>
          ))}
          {filtered.length === 0 && <div className="search-select-item search-select-empty">No matches</div>}
        </div>
      )}
    </div>
  );
}

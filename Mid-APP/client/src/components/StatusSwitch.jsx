// Two-option Active | Inactive switch - both choices always visible, the
// current one highlighted; clicking the other one calls onChange(nextActive).
export default function StatusSwitch({ active, onChange, disabled = false, title }) {
  return (
    <div className="status-switch" role="group" aria-label="Status" title={title}>
      <button
        type="button"
        className={active ? 'on active-on' : ''}
        aria-pressed={active}
        disabled={disabled || active}
        onClick={() => onChange(true)}
      >
        Active
      </button>
      <button
        type="button"
        className={!active ? 'on inactive-on' : ''}
        aria-pressed={!active}
        disabled={disabled || !active}
        onClick={() => onChange(false)}
      >
        Inactive
      </button>
    </div>
  );
}

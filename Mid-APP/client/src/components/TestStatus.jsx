// Shared test-status visuals for the Orders list and the Laboratory queue, so a
// colour means the same stage everywhere. A "test" here is any object with
// { testName, status, itemStatus? }: status is the Sample status, itemStatus
// the BillItem status (CANCELLED there takes the test out of the journey).

// A test's lab journey, in order. Sample.status walks these left to right.
export const TEST_STAGES = [
  { key: 'PENDING_COLLECTION', label: 'Pending collection', short: 'Sample' },
  { key: 'COLLECTED', label: 'Collected', short: 'Collected' },
  { key: 'RESULT_ENTERED', label: 'Result entered', short: 'Result' },
  { key: 'VERIFIED', label: 'Verified', short: 'Verified' },
  { key: 'RELEASED', label: 'Released', short: 'Released' },
];

export function testStatusKey(t) {
  if (t.itemStatus === 'CANCELLED' || t.status === 'CANCELLED') return 'CANCELLED';
  return t.status || 'PENDING_COLLECTION';
}

export function testStatusLabel(key) {
  return key === 'CANCELLED' ? 'Cancelled' : (TEST_STAGES.find((s) => s.key === key)?.label || key);
}

export function StatusPill({ status }) {
  return <span className={`status-pill ${status}`}><i className="dot" />{testStatusLabel(status)}</span>;
}

// Colour key, shown once above a list.
export function StatusLegend() {
  return (
    <div className="status-legend">
      <span className="status-legend-title">Test status:</span>
      {[...TEST_STAGES, { key: 'CANCELLED', label: 'Cancelled' }].map((s) => (
        <span key={s.key} className={`legend-item ${s.key}`}><i className="dot" />{s.label}</span>
      ))}
    </div>
  );
}

// Compact summary: count, a stacked bar of how many tests sit at each stage,
// released x/y, then the first few tests as status-dot chips and a toggle -
// so a 10+ test order stays one tidy block.
export function TestStatusSummary({ tests, chipsShown = 2, expanded, onToggle }) {
  const active = tests.filter((t) => testStatusKey(t) !== 'CANCELLED');
  const released = active.filter((t) => t.status === 'RELEASED').length;
  const counts = [...TEST_STAGES.map((s) => s.key), 'CANCELLED']
    .map((key) => ({ key, n: tests.filter((t) => testStatusKey(t) === key).length }))
    .filter((c) => c.n > 0);
  const hidden = tests.length - chipsShown;

  return (
    <div className="order-tests">
      <div className="order-tests-head">
        <strong>{tests.length} test{tests.length === 1 ? '' : 's'}</strong>
        <div className="order-tests-bar" title={counts.map((c) => `${testStatusLabel(c.key)}: ${c.n}`).join('\n')}>
          {counts.map((c) => <span key={c.key} className={`seg ${c.key}`} style={{ flexGrow: c.n }} />)}
        </div>
        <span className={released === active.length && active.length > 0 ? 'done' : ''} title="Released">
          {released}/{active.length}
        </span>
      </div>
      <div className="order-tests-chips">
        {tests.slice(0, chipsShown).map((t, i) => {
          const key = testStatusKey(t);
          return (
            <span key={i} className={`test-chip ${key}`} title={`${t.testName} — ${testStatusLabel(key)}`}>
              <i className="dot" /><span className="name">{t.testName}</span>
            </span>
          );
        })}
        {onToggle && (
          <button
            type="button"
            className={`test-more-btn${hidden > 0 ? '' : ' subtle'}`}
            onClick={onToggle}
            title={expanded ? 'Hide test status' : 'Show every test with its status'}
          >
            {hidden > 0 && !expanded ? `+${hidden}` : ''}{expanded ? '▴' : ' ▾'}
          </button>
        )}
      </div>
    </div>
  );
}

// Every test as a card with its status and a 5-step tracker (wide spaces).
export function TestStatusDetail({ tests }) {
  return (
    <div className="order-tests-detail">
      {tests.map((t, i) => {
        const key = testStatusKey(t);
        const stageIdx = TEST_STAGES.findIndex((s) => s.key === key);
        return (
          <div key={i} className={`test-card ${key}`}>
            <div className="test-card-top">
              <span className="test-card-name" title={t.testName}>{t.testName}</span>
              <StatusPill status={key} />
            </div>
            {key === 'CANCELLED' ? (
              <div className="test-card-cancelled">Cancelled{Number(t.refundedAmount) > 0 ? ` · ₹${Number(t.refundedAmount).toFixed(2)} refunded` : ''}</div>
            ) : (
              <div className="test-steps">
                {TEST_STAGES.map((s, si) => (
                  <div key={s.key} className={`test-step${si <= stageIdx ? ' reached' : ''}${si === stageIdx ? ' current' : ''}`}>
                    <i />
                    <span>{s.short}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// Every test as one slim row - name and status pill (narrow spaces, e.g. a card).
export function TestStatusList({ tests }) {
  return (
    <div className="test-status-list">
      {tests.map((t, i) => {
        const key = testStatusKey(t);
        return (
          <div key={i} className="test-status-row">
            <span className="name" title={t.testName}>{t.testName}</span>
            <StatusPill status={key} />
          </div>
        );
      })}
    </div>
  );
}

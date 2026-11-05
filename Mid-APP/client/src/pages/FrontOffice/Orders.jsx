import { Fragment, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import { Icon } from '../../components/Icons';
import { StatusLegend, TestStatusSummary, TestStatusDetail } from '../../components/TestStatus';
import { doctorLabel, patientLabel } from '../../utils/format';

const REFUND_MODES = ['Cash', 'Card', 'UPI', 'Insurance'];

function daysAgoISO(days) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}
function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

export default function Orders() {
  const navigate = useNavigate();
  const { auth } = useAuth();
  const canConfigure = auth?.user?.roles?.includes('ADMIN') || auth?.user?.roles?.includes('MANAGER');
  const [settings, setSettings] = useState(null); // { allowBillCancellationRefund, refundAllowedDays, allowPostBillingDiscount, postDiscountAllowedDays }
  const [settingsForm, setSettingsForm] = useState({ refundAllowedDays: '0', postDiscountAllowedDays: '0', defaultGstPercent: '0' });
  const [showSettings, setShowSettings] = useState(false);
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [settingsMessage, setSettingsMessage] = useState('');

  const [bills, setBills] = useState([]);
  const [expandedBillIds, setExpandedBillIds] = useState(() => new Set());
  const [search, setSearch] = useState('');
  // Defaults to the last 7 days so the list isn't every order ever placed -
  // "Clear dates" (below) drops the filter to show everything.
  const [fromDate, setFromDate] = useState(() => daysAgoISO(7));
  const [toDate, setToDate] = useState(() => todayISO());
  const [refundBill, setRefundBill] = useState(null); // the bill row being cancelled/refunded
  const [refundItem, setRefundItem] = useState(null); // which test within that bill
  const [refundForm, setRefundForm] = useState({ amount: '', mode: 'Cash', reason: '' });
  const [refundError, setRefundError] = useState('');
  const [refundSaving, setRefundSaving] = useState(false);

  const [discountBill, setDiscountBill] = useState(null); // the bill row getting a post-billing discount
  const [discountForm, setDiscountForm] = useState({ amount: '', mode: 'Cash', reason: '' });
  const [discountError, setDiscountError] = useState('');
  const [discountSaving, setDiscountSaving] = useState(false);

  async function load() {
    const { data } = await api.get('/billing/bills');
    setBills(data);
    return data;
  }
  async function loadSettings() {
    const { data } = await api.get('/billing-settings');
    setSettings(data);
    setSettingsForm({
      refundAllowedDays: String(data.refundAllowedDays ?? 0),
      postDiscountAllowedDays: String(data.postDiscountAllowedDays ?? 0),
      defaultGstPercent: String(data.defaultGstPercent ?? 0),
    });
  }
  useEffect(() => { load(); loadSettings(); }, []);

  const filtered = bills.filter((b) => {
    const q = search.toLowerCase();
    const matchesSearch = !q
      || b.billNo.toLowerCase().includes(q)
      || b.patient?.name?.toLowerCase().includes(q)
      || b.patient?.umr?.toLowerCase().includes(q)
      || b.patient?.mobile?.includes(q);
    const matchesFrom = !fromDate || b.walkInDate >= fromDate;
    const matchesTo = !toDate || b.walkInDate <= toDate;
    return matchesSearch && matchesFrom && matchesTo;
  });

  // Every test on every currently-visible bill, counted by its own status - not
  // just the bill's - since one bill can carry tests at different stages.
  const testCounts = useMemo(() => {
    const tests = filtered.flatMap((b) => b.tests);
    const total = tests.length;
    const cancelled = tests.filter((t) => t.itemStatus === 'CANCELLED').length;
    const done = tests.filter((t) => t.status === 'RELEASED' && t.itemStatus !== 'CANCELLED').length;
    return { total, cancelled, done, pending: total - done - cancelled };
  }, [filtered]);

  function toggleExpanded(billId) {
    setExpandedBillIds((prev) => {
      const next = new Set(prev);
      if (next.has(billId)) next.delete(billId); else next.add(billId);
      return next;
    });
  }

  async function toggleSetting(key, label) {
    setSettingsSaving(true);
    setSettingsMessage('');
    try {
      const { data } = await api.put('/billing-settings', { [key]: !settings[key] });
      setSettings(data);
      setSettingsMessage(`${label} is now ${data[key] ? 'enabled' : 'disabled'}.`);
    } catch (err) {
      setSettingsMessage(err.response?.data?.message || 'Failed to update setting');
    } finally {
      setSettingsSaving(false);
    }
  }

  async function saveDaysLimit(e, key, label) {
    e.preventDefault();
    setSettingsSaving(true);
    setSettingsMessage('');
    try {
      const { data } = await api.put('/billing-settings', { [key]: Number(settingsForm[key]) || 0 });
      setSettings(data);
      setSettingsMessage(
        data[key] > 0
          ? `${label} now allowed within ${data[key]} day(s) of billing.`
          : `${label} now allowed with no day limit.`,
      );
    } catch (err) {
      setSettingsMessage(err.response?.data?.message || 'Failed to update setting');
    } finally {
      setSettingsSaving(false);
    }
  }

  function openRefundModal(bill) {
    setRefundBill(bill);
    setRefundItem(null);
    setRefundError('');
  }

  // The refund is fixed by the server: the test's amount after its share of
  // the bill discount (item.maxRefund) - not its list price, and not editable.
  function startRefundFor(item) {
    setRefundItem(item);
    setRefundForm({ amount: String(item.maxRefund ?? 0), mode: 'Cash', reason: '' });
    setRefundError('');
  }

  async function submitRefund(e) {
    e.preventDefault();
    setRefundError('');
    setRefundSaving(true);
    try {
      await api.put(`/billing/bills/${refundBill.id}/items/${refundItem.id}/cancel`, {
        amount: Number(refundForm.amount),
        mode: refundForm.mode,
        reason: refundForm.reason || undefined,
      });
      setRefundItem(null);
      const freshBills = await load();
      // refresh the modal's own bill snapshot from the freshly reloaded list
      setRefundBill((prev) => freshBills.find((b) => b.id === prev?.id) || prev);
    } catch (err) {
      setRefundError(err.response?.data?.message || 'Failed to record cancellation/refund');
    } finally {
      setRefundSaving(false);
    }
  }

  function openDiscountModal(bill) {
    setDiscountBill(bill);
    setDiscountForm({ amount: '', mode: 'Cash', reason: '' });
    setDiscountError('');
  }

  async function submitDiscount(e) {
    e.preventDefault();
    if (discountSaving) return; // guard against a rapid double-submit
    setDiscountError('');
    setDiscountSaving(true);
    try {
      await api.put(`/billing/bills/${discountBill.id}/discount`, {
        amount: Number(discountForm.amount),
        mode: discountForm.mode,
        reason: discountForm.reason,
      });
      setDiscountBill(null);
      await load();
    } catch (err) {
      setDiscountError(err.response?.data?.message || 'Failed to apply discount');
    } finally {
      setDiscountSaving(false);
    }
  }

  async function handleCancelDiscount(discountId) {
    setDiscountError('');
    setDiscountSaving(true);
    try {
      await api.put(`/billing/bills/${discountBill.id}/discounts/${discountId}/cancel`);
      const freshBills = await load();
      setDiscountBill((prev) => freshBills.find((b) => b.id === prev?.id) || prev);
    } catch (err) {
      setDiscountError(err.response?.data?.message || 'Failed to cancel discount');
    } finally {
      setDiscountSaving(false);
    }
  }

  return (
    <div className="card orders-card">
      <div className="topbar compact-header">
        <h3 style={{ margin: 0 }}>Orders</h3>
        <div className="status-summary">
          <div className="stat-chip"><span className="stat-value">{testCounts.total}</span><span className="stat-label">Total</span></div>
          <div className="stat-chip pending"><span className="stat-value">{testCounts.pending}</span><span className="stat-label">Pending</span></div>
          <div className="stat-chip done"><span className="stat-value">{testCounts.done}</span><span className="stat-label">Done</span></div>
          <div className="stat-chip cancelled"><span className="stat-value">{testCounts.cancelled}</span><span className="stat-label">Cancel</span></div>
        </div>
        <div className="compact-filters">
          <div className="df-field"><span>From</span><input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} /></div>
          <div className="df-field"><span>To</span><input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} /></div>
          {(fromDate || toDate) && (
            <button type="button" className="secondary" onClick={() => { setFromDate(''); setToDate(''); }}>
              Clear
            </button>
          )}
          <input placeholder="Search by Order ID, UMR, name or mobile…" value={search} onChange={(e) => setSearch(e.target.value)} />
          {canConfigure && <button type="button" onClick={() => setShowSettings(true)}>⚙ Settings</button>}
        </div>
      </div>
      <StatusLegend />
      <table className="orders-table">
        <thead>
          <tr>
            <th>Order</th><th>Patient</th><th>Ref. Doctor</th><th>Amount</th><th>Tests</th><th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {filtered.map((b) => {
            const anyReleased = b.tests.some((t) => t.status === 'RELEASED');
            const expanded = expandedBillIds.has(b.id);
            return (
              <Fragment key={b.id}>
              <tr className={expanded ? 'order-row-expanded' : ''}>
                <td>
                  <div className="cell-main">{b.billNo}</div>
                  <div className="cell-sub">{b.walkInDate}{auth?.client?.multiLocation && b.location ? ` · ${b.location}` : ''}</div>
                </td>
                <td>
                  <div className="cell-main">{patientLabel(b.patient)}</div>
                  <div className="cell-sub">{b.patient?.umr}{b.patient?.mobile ? ` · ${b.patient.mobile}` : ''}</div>
                </td>
                <td>{doctorLabel(b.referredDoctor) || '—'}</td>
                <td>
                  <div className="cell-main">₹{b.paidAmount}</div>
                  {Number(b.dueAmount) > 0 && <div className="cell-sub due">Due ₹{b.dueAmount}</div>}
                </td>
                <td>
                  <TestStatusSummary tests={b.tests} expanded={expanded} onToggle={() => toggleExpanded(b.id)} />
                </td>
                <td>
                  <div className="order-actions">
                  <button className="icon-btn" title="Edit" aria-label="Edit" onClick={() => navigate(`/app/orders/${b.id}/edit`)}>
                    <Icon name="edit" size={15} />
                  </button>
                  <button className="icon-btn" title="Print Bill" aria-label="Print Bill" onClick={() => navigate(`/app/billing/print/${b.id}`)}>
                    <Icon name="print" size={15} />
                  </button>
                  <button className="icon-btn" title="Print Report" aria-label="Print Report" disabled={!anyReleased} onClick={() => navigate(`/app/report/${b.id}`)}>
                    <Icon name="reports" size={15} />
                  </button>
                  {settings?.allowBillCancellationRefund && (
                    <button className="icon-btn" title="Cancel / Refund" aria-label="Cancel / Refund" onClick={() => openRefundModal(b)}>
                      <Icon name="refund" size={15} />
                    </button>
                  )}
                  {settings?.allowPostBillingDiscount && Number(b.paidAmount) > 0 && (
                    <button className="icon-btn" title="Discount" aria-label="Discount" onClick={() => openDiscountModal(b)}>
                      <Icon name="percent" size={15} />
                    </button>
                  )}
                  </div>
                </td>
              </tr>
              {expanded && (
                <tr className="order-tests-row">
                  <td colSpan={6}><TestStatusDetail tests={b.tests} /></td>
                </tr>
              )}
              </Fragment>
            );
          })}
          {filtered.length === 0 && <tr><td colSpan={6}>No orders found.</td></tr>}
        </tbody>
      </table>

      {showSettings && (
        <div className="modal-overlay" onClick={() => setShowSettings(false)}>
          <div className="modal-card" style={{ maxWidth: 460 }} onClick={(e) => e.stopPropagation()}>
            <button type="button" className="modal-close-btn" onClick={() => setShowSettings(false)} aria-label="Close">×</button>
            <h2>Orders Settings</h2>
            <p style={{ fontSize: 13, color: '#64748b' }}>
              Available to Admin and Manager. Controls cancellation/refund and post-billing discount for
              Front Office, from this same Orders screen.
            </p>
            {settings ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', border: '1px solid #e2e8f0', borderRadius: 8, padding: 12 }}>
                  <div>
                    <strong>Bill Cancellation & Refund</strong>
                    <div style={{ fontSize: 12, color: '#64748b' }}>
                      Currently {settings.allowBillCancellationRefund ? 'enabled' : 'disabled'} for this clinic.
                    </div>
                  </div>
                  <button type="button" onClick={() => toggleSetting('allowBillCancellationRefund', 'Cancellation & Refund')} disabled={settingsSaving}>
                    {settingsSaving ? 'Saving…' : settings.allowBillCancellationRefund ? 'Disable' : 'Enable'}
                  </button>
                </div>

                <form
                  onSubmit={(e) => saveDaysLimit(e, 'refundAllowedDays', 'Cancellation & refund')}
                  style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, border: '1px solid #e2e8f0', borderRadius: 8, padding: 12 }}
                >
                  <div>
                    <strong>Cancellation & Refund Allowed Days</strong>
                    <div style={{ fontSize: 12, color: '#64748b' }}>
                      How many days after billing a test can still be cancelled/refunded. 0 = no limit.
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <input
                      type="number" min="0" step="1" style={{ width: 70 }}
                      value={settingsForm.refundAllowedDays}
                      onChange={(e) => setSettingsForm((f) => ({ ...f, refundAllowedDays: e.target.value }))}
                    />
                    <button type="submit" disabled={settingsSaving}>Save</button>
                  </div>
                </form>

                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', border: '1px solid #e2e8f0', borderRadius: 8, padding: 12 }}>
                  <div>
                    <strong>Post-Billing Discount</strong>
                    <div style={{ fontSize: 12, color: '#64748b' }}>
                      Currently {settings.allowPostBillingDiscount ? 'enabled' : 'disabled'} for this clinic.
                    </div>
                  </div>
                  <button type="button" onClick={() => toggleSetting('allowPostBillingDiscount', 'Post-Billing Discount')} disabled={settingsSaving}>
                    {settingsSaving ? 'Saving…' : settings.allowPostBillingDiscount ? 'Disable' : 'Enable'}
                  </button>
                </div>

                <form
                  onSubmit={(e) => saveDaysLimit(e, 'postDiscountAllowedDays', 'Post-billing discount')}
                  style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, border: '1px solid #e2e8f0', borderRadius: 8, padding: 12 }}
                >
                  <div>
                    <strong>Post-Billing Discount Allowed Days</strong>
                    <div style={{ fontSize: 12, color: '#64748b' }}>
                      How many days after billing an extra discount can still be applied. 0 = no limit.
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <input
                      type="number" min="0" step="1" style={{ width: 70 }}
                      value={settingsForm.postDiscountAllowedDays}
                      onChange={(e) => setSettingsForm((f) => ({ ...f, postDiscountAllowedDays: e.target.value }))}
                    />
                    <button type="submit" disabled={settingsSaving}>Save</button>
                  </div>
                </form>

                <form
                  onSubmit={(e) => saveDaysLimit(e, 'defaultGstPercent', 'Default GST %')}
                  style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, border: '1px solid #e2e8f0', borderRadius: 8, padding: 12 }}
                >
                  <div>
                    <strong>Default GST %</strong>
                    <div style={{ fontSize: 12, color: '#64748b' }}>
                      Pre-fills GST on every new bill (split evenly into CGST + SGST). 0 = no tax charged.
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <input
                      type="number" min="0" max="100" step="0.01" style={{ width: 70 }}
                      value={settingsForm.defaultGstPercent}
                      onChange={(e) => setSettingsForm((f) => ({ ...f, defaultGstPercent: e.target.value }))}
                    />
                    <button type="submit" disabled={settingsSaving}>Save</button>
                  </div>
                </form>
              </div>
            ) : <p>Loading…</p>}
            {settingsMessage && <p style={{ fontSize: 13, color: '#166534' }}>{settingsMessage}</p>}
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}>
              <button type="button" onClick={() => setShowSettings(false)}>Close</button>
            </div>
          </div>
        </div>
      )}

      {refundBill && (
        <div className="modal-overlay" onClick={() => setRefundBill(null)}>
          <div className="modal-card" style={{ maxWidth: 560 }} onClick={(e) => e.stopPropagation()}>
            <h2>Cancel / Refund — {refundBill.billNo}</h2>
            <p style={{ fontSize: 13, color: '#64748b' }}>
              Cancelling a test is per-test - the rest of the bill's tests are unaffected. The refund is that
              test's amount after its share of the bill discount, so the discount on the remaining tests
              stays correct.
            </p>
            <table>
              <thead><tr><th>Test</th><th>Price</th><th title="Price after its share of the bill discount (and GST)">After Discount</th><th>Refunded</th><th>Status</th><th></th></tr></thead>
              <tbody>
                {refundBill.tests.map((t) => {
                  return (
                    <tr key={t.id}>
                      <td>{t.testName}</td>
                      <td>₹{Number(t.price).toFixed(2)}</td>
                      <td>{t.charge != null ? `₹${Number(t.charge).toFixed(2)}` : '—'}</td>
                      <td>₹{Number(t.refundedAmount || 0).toFixed(2)}</td>
                      <td>{t.itemStatus === 'CANCELLED' ? <span className="badge CANCELLED">Cancelled</span> : <span className="badge">Active</span>}</td>
                      <td>
                        {t.itemStatus !== 'CANCELLED' && t.status !== 'RELEASED' && (
                          <button type="button" onClick={() => startRefundFor(t)}>Cancel & Refund</button>
                        )}
                        {t.status === 'RELEASED' && t.itemStatus !== 'CANCELLED' && (
                          <span style={{ fontSize: 12, color: '#94a3b8' }}>Report released</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            {refundItem && (
              <form onSubmit={submitRefund} style={{ marginTop: 16, borderTop: '1px solid #e2e8f0', paddingTop: 12 }}>
                <h4 style={{ margin: '0 0 8px' }}>Refund for {refundItem.testName}</h4>
                <p style={{ fontSize: 13, color: '#475569', margin: '0 0 8px' }}>
                  Price ₹{Number(refundItem.price).toFixed(2)} · after its share of the bill discount ₹{Number(refundItem.charge || 0).toFixed(2)}
                  {Number(refundItem.fromDue) > 0 && <> · ₹{Number(refundItem.fromDue).toFixed(2)} clears the amount still due</>}
                </p>
                <div className="form-grid">
                  <label><span>Refund Amount</span>
                    <input value={`₹${Number(refundForm.amount || 0).toFixed(2)}`} readOnly style={{ fontWeight: 700, background: '#f8fafc' }} />
                  </label>
                  <label><span>Payment Mode</span>
                    <select value={refundForm.mode} onChange={(e) => setRefundForm((f) => ({ ...f, mode: e.target.value }))}>
                      {REFUND_MODES.map((m) => <option key={m}>{m}</option>)}
                    </select>
                  </label>
                  <label><span>Reason (optional)</span>
                    <input value={refundForm.reason} onChange={(e) => setRefundForm((f) => ({ ...f, reason: e.target.value }))} />
                  </label>
                </div>
                {refundError && <p className="error-text">{refundError}</p>}
                <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                  <button type="button" onClick={() => setRefundItem(null)}>Back</button>
                  <button type="submit" disabled={refundSaving}>{refundSaving ? 'Saving…' : 'Confirm Cancellation & Refund'}</button>
                </div>
              </form>
            )}

            {!refundItem && (
              <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}>
                <button type="button" onClick={() => setRefundBill(null)}>Close</button>
              </div>
            )}
          </div>
        </div>
      )}

      {discountBill && (
        <div className="modal-overlay" onClick={() => setDiscountBill(null)}>
          <div className="modal-card" style={{ maxWidth: 480 }} onClick={(e) => e.stopPropagation()}>
            <h2>Discount — {discountBill.billNo}</h2>
            <p style={{ fontSize: 13, color: '#64748b' }}>
              Applies an extra discount to this bill after billing, on top of any discount already given.
              Since the bill was already collected in full, this amount is handed back to the patient.
            </p>

            {(discountBill.discounts || []).length > 0 && (
              <table style={{ marginBottom: 12 }}>
                <thead><tr><th>Amount</th><th>Mode</th><th>Reason</th><th>Status</th><th></th></tr></thead>
                <tbody>
                  {discountBill.discounts.map((d) => (
                    <tr key={d.id}>
                      <td>₹{d.amount}</td>
                      <td>{d.mode}</td>
                      <td>{d.reason}</td>
                      <td>{d.cancelledAt ? <span className="badge CANCELLED">Cancelled</span> : <span className="badge PAID">Active</span>}</td>
                      <td>
                        {!d.cancelledAt && (
                          <button type="button" className="secondary" disabled={discountSaving} onClick={() => handleCancelDiscount(d.id)}>
                            Cancel
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            <form onSubmit={submitDiscount}>
              <div className="form-grid">
                <label><span>Discount Amount (max ₹{Number(discountBill.paidAmount).toFixed(2)})</span>
                  <input
                    type="number" min="0.01" step="0.01"
                    max={Number(discountBill.paidAmount)}
                    value={discountForm.amount}
                    onChange={(e) => setDiscountForm((f) => ({ ...f, amount: e.target.value }))}
                    required
                  />
                </label>
                <label><span>Payment Mode</span>
                  <select value={discountForm.mode} onChange={(e) => setDiscountForm((f) => ({ ...f, mode: e.target.value }))}>
                    {REFUND_MODES.map((m) => <option key={m}>{m}</option>)}
                  </select>
                </label>
                <label><span>Reason</span>
                  <input value={discountForm.reason} onChange={(e) => setDiscountForm((f) => ({ ...f, reason: e.target.value }))} required />
                </label>
              </div>
              {discountError && <p className="error-text">{discountError}</p>}
              <div style={{ display: 'flex', gap: 8, marginTop: 8, justifyContent: 'flex-end' }}>
                <button type="button" onClick={() => setDiscountBill(null)}>Cancel</button>
                <button type="submit" disabled={discountSaving}>{discountSaving ? 'Saving…' : 'Apply Discount'}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

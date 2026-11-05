import { useEffect, useMemo, useState } from 'react';
import api from '../../api/client';
import { Icon } from '../../components/Icons';

// One place for Chief Admin to switch tests off platform-wide or delete them
// with all their master data. Delete is only allowed while a test has no
// patient history - the server decides, and the popup shows why it's blocked.
export default function TestRemoval() {
  const [tests, setTests] = useState([]);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('All');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [busyId, setBusyId] = useState(null);

  const [deleting, setDeleting] = useState(null); // { test, usage } while the delete popup is open
  const [deleteBusy, setDeleteBusy] = useState(false);

  const [selected, setSelected] = useState(() => new Set()); // test ids ticked for a bulk action
  const [bulkBusy, setBulkBusy] = useState(''); // the bulk action running, if any
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const [skipped, setSkipped] = useState([]); // tests a bulk delete couldn't remove, with why

  async function load() {
    const { data } = await api.get('/admin/masters/tests');
    setTests(data);
    // Drop selections for tests that no longer exist (e.g. just deleted).
    const ids = new Set(data.map((t) => t.id));
    setSelected((prev) => new Set([...prev].filter((id) => ids.has(id))));
  }
  useEffect(() => { load(); }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return tests.filter((t) => {
      if (statusFilter === 'Active' && t.active === false) return false;
      if (statusFilter === 'Inactive' && t.active !== false) return false;
      return !q || `${t.testCode} ${t.testName} ${t.category || ''}`.toLowerCase().includes(q);
    });
  }, [tests, search, statusFilter]);

  const inactiveCount = tests.filter((t) => t.active === false).length;

  // "Select all" works on what's currently shown (search + status filter).
  const allShownSelected = filtered.length > 0 && filtered.every((t) => selected.has(t.id));
  function toggleAllShown() {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const t of filtered) {
        if (allShownSelected) next.delete(t.id);
        else next.add(t.id);
      }
      return next;
    });
  }
  function toggleOne(id) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function runBulk(action) {
    const testIds = [...selected];
    if (action === 'deactivate' && !window.confirm(`Mark ${testIds.length} test(s) Inactive?\n\nNo client will be able to bill them. Old bills and reports keep them.`)) return;
    setError('');
    setMessage('');
    setSkipped([]);
    setBulkBusy(action);
    try {
      const { data } = await api.post('/admin/masters/tests/bulk', { action, testIds });
      const verb = { activate: 'made Active', deactivate: 'made Inactive', delete: 'deleted with their master data' }[action];
      setMessage(`${data.done} test(s) ${verb}.${data.skipped.length ? ` ${data.skipped.length} could not be deleted - see below.` : ''}`);
      setSkipped(data.skipped);
      // Keep the skipped ones ticked so "Make Inactive" can be applied to them next.
      setSelected(new Set(data.skipped.map((s) => s.id)));
      await load();
    } catch (err) {
      setError(err.response?.data?.message || 'Bulk action failed');
    } finally {
      setBulkBusy('');
      setBulkDeleteOpen(false);
    }
  }

  async function setActive(test, active) {
    if (!active && !window.confirm(`Mark "${test.testName}" Inactive?\n\nNo client will be able to bill it. Old bills and reports keep it, and you can make it Active again any time.`)) return;
    setError('');
    setMessage('');
    setBusyId(test.id);
    try {
      await api.put(`/admin/masters/tests/${test.id}`, { active });
      setMessage(`${test.testName} is now ${active ? 'Active' : 'Inactive'}.`);
      await load();
    } catch (err) {
      setError(err.response?.data?.message || 'Could not change the test status');
    } finally {
      setBusyId(null);
    }
  }

  async function openDelete(test) {
    setError('');
    setMessage('');
    setBusyId(test.id);
    try {
      const { data } = await api.get(`/admin/masters/tests/${test.id}/usage`);
      setDeleting({ test, usage: data });
    } catch (err) {
      setError(err.response?.data?.message || 'Could not check where this test is used');
    } finally {
      setBusyId(null);
    }
  }

  async function confirmDelete() {
    const { test } = deleting;
    setDeleteBusy(true);
    try {
      await api.delete(`/admin/masters/tests/${test.id}`);
      setDeleting(null);
      setMessage(`${test.testName} (${test.testCode}) and its master data were deleted.`);
      await load();
    } catch (err) {
      setError(err.response?.data?.message || 'Could not delete the test');
      setDeleting(null);
    } finally {
      setDeleteBusy(false);
    }
  }

  async function inactivateInstead() {
    const { test } = deleting;
    setDeleting(null);
    await setActive(test, false);
  }

  return (
    <div>
      <div className="card" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <span className="icon-badge" style={{ width: 40, height: 40 }}><Icon name="masters" size={20} /></span>
        <div>
          <h3 style={{ margin: 0 }}>Test Removal</h3>
          <p style={{ margin: 0, fontSize: 13, color: '#64748b' }}>
            Make a test inactive for all clients, or delete it with all its master data
          </p>
        </div>
      </div>

      <div className="card">
        <div className="masters-row" style={{ marginBottom: 10 }}>
          <input className="masters-search" placeholder="Search by code, name or group…" value={search} onChange={(e) => setSearch(e.target.value)} />
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} style={{ width: 180 }}>
            <option value="All">All tests ({tests.length})</option>
            <option value="Active">Active ({tests.length - inactiveCount})</option>
            <option value="Inactive">Inactive ({inactiveCount})</option>
          </select>
          {/* Also here, not just in the table header - on phones the table
              turns into cards and its header row isn't shown. */}
          <label style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', alignSelf: 'center', gap: 6, fontSize: 13, fontWeight: 500, color: '#334155', whiteSpace: 'nowrap', margin: 0 }}>
            <input type="checkbox" checked={allShownSelected} onChange={toggleAllShown} disabled={filtered.length === 0} style={{ width: 16, height: 16 }} />
            Select all shown ({filtered.length})
          </label>
        </div>

        {selected.size > 0 && (
          <div style={{
            display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, padding: '8px 10px',
            marginBottom: 10, background: '#f1f5f9', borderRadius: 8,
          }}>
            <strong style={{ fontSize: 13 }}>{selected.size} selected</strong>
            <button type="button" className="secondary" disabled={!!bulkBusy} onClick={() => runBulk('deactivate')}>
              {bulkBusy === 'deactivate' ? 'Working…' : 'Make Inactive'}
            </button>
            <button type="button" className="secondary" disabled={!!bulkBusy} onClick={() => runBulk('activate')}>
              {bulkBusy === 'activate' ? 'Working…' : 'Make Active'}
            </button>
            <button type="button" className="danger" disabled={!!bulkBusy} onClick={() => setBulkDeleteOpen(true)}>Delete</button>
            <button type="button" className="secondary" disabled={!!bulkBusy} onClick={() => setSelected(new Set())}>Clear</button>
          </div>
        )}

        {error && <p className="error-text">{error}</p>}
        {message && <p style={{ color: '#166534' }}>{message}</p>}
        {skipped.length > 0 && (
          <div style={{ marginBottom: 10 }}>
            <p style={{ fontSize: 13, margin: '0 0 4px' }}>Not deleted (still selected, so you can make them Inactive):</p>
            <ul style={{ fontSize: 13, margin: 0 }}>
              {skipped.map((s) => <li key={s.id}><strong>{s.testCode}</strong> {s.testName} — {s.reason}</li>)}
            </ul>
          </div>
        )}

        <div className="masters-table-wrap">
          <table className="orders-table">
            <thead>
              <tr>
                <th style={{ width: 30 }}>
                  <input type="checkbox" title="Select all shown" checked={allShownSelected} onChange={toggleAllShown} style={{ width: 16, height: 16 }} />
                </th>
                <th>Code</th><th>Test Name</th><th>Group</th><th>Parameters</th><th>Status</th><th></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((t) => (
                <tr key={t.id}>
                  <td>
                    <input type="checkbox" checked={selected.has(t.id)} onChange={() => toggleOne(t.id)} style={{ width: 16, height: 16 }} />
                  </td>
                  <td>{t.testCode}</td>
                  <td className="cell-main">{t.testName}</td>
                  <td>{t.category || 'Uncategorized'}</td>
                  <td>{(t.ParameterMasters || []).length}</td>
                  <td>
                    <span className={`badge ${t.active === false ? 'EXPIRED' : 'PAID'}`}>{t.active === false ? 'Inactive' : 'Active'}</span>
                  </td>
                  <td>
                    <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                      <button type="button" className="secondary" disabled={busyId === t.id} onClick={() => setActive(t, t.active === false)}>
                        {t.active === false ? 'Make Active' : 'Make Inactive'}
                      </button>
                      <button type="button" className="danger" disabled={busyId === t.id} onClick={() => openDelete(t)}>Delete</button>
                    </div>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && <tr><td colSpan={7}>No tests found.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      {bulkDeleteOpen && (
        <div className="modal-overlay" onClick={() => !bulkBusy && setBulkDeleteOpen(false)}>
          <div className="modal-card" style={{ textAlign: 'left', width: 480 }} onClick={(e) => e.stopPropagation()}>
            <h2>Delete {selected.size} test(s)</h2>
            <p style={{ fontSize: 14 }}>
              Each selected test is permanently removed with, for every client, its parameters and normal ranges,
              client prices, short names, payor prices and package links.
            </p>
            <p style={{ fontSize: 14 }}>
              Tests already on a patient bill, with results entered, or sharing parameters with another test are
              skipped and listed afterwards - you can make those Inactive instead.
            </p>
            <p className="error-text" style={{ marginTop: 0 }}>This cannot be undone.</p>
            <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
              <button type="button" className="danger" disabled={!!bulkBusy} onClick={() => runBulk('delete')}>
                {bulkBusy === 'delete' ? 'Deleting…' : `Delete ${selected.size} Permanently`}
              </button>
              <button type="button" className="secondary" disabled={!!bulkBusy} onClick={() => setBulkDeleteOpen(false)}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {deleting && (
        <div className="modal-overlay" onClick={() => !deleteBusy && setDeleting(null)}>
          <div className="modal-card" style={{ textAlign: 'left', width: 480 }} onClick={(e) => e.stopPropagation()}>
            <h2>Delete {deleting.test.testName}</h2>
            <p className="meta" style={{ marginTop: 0 }}>{deleting.test.testCode}</p>

            {deleting.usage.canDelete ? (
              <>
                <p style={{ fontSize: 14 }}>This permanently removes the test and, for every client:</p>
                <ul style={{ fontSize: 14, marginTop: 0 }}>
                  <li>{deleting.usage.parameters} parameter(s) and their normal ranges</li>
                  <li>{deleting.usage.clientPrices} client price(s)</li>
                  <li>{deleting.usage.shortNames} short name(s)</li>
                  <li>{deleting.usage.payorPrices} payor price(s)</li>
                  <li>{deleting.usage.packages} package link(s)</li>
                </ul>
                <p className="error-text" style={{ marginTop: 0 }}>This cannot be undone.</p>
                <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                  <button type="button" className="danger" disabled={deleteBusy} onClick={confirmDelete}>
                    {deleteBusy ? 'Deleting…' : 'Delete Permanently'}
                  </button>
                  <button type="button" className="secondary" disabled={deleteBusy} onClick={() => setDeleting(null)}>Cancel</button>
                </div>
              </>
            ) : (
              <>
                <p className="error-text">{deleting.usage.blockedReason}</p>
                <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                  {deleting.test.active !== false && (
                    <button type="button" onClick={inactivateInstead}>Make Inactive Instead</button>
                  )}
                  <button type="button" className="secondary" onClick={() => setDeleting(null)}>Close</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

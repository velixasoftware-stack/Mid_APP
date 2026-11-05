import { useEffect, useState } from 'react';
import api from '../../api/client';
import { useAuth } from '../../context/AuthContext';

export default function Tickets() {
  const { auth } = useAuth();
  const [tickets, setTickets] = useState([]);
  const [form, setForm] = useState({ subject: '', description: '' });
  const isAdmin = (auth?.user?.roles || []).includes('ADMIN');

  async function load() {
    const { data } = await api.get('/tickets');
    setTickets(data);
  }
  useEffect(() => { load(); }, []);

  async function handleCreate(e) {
    e.preventDefault();
    await api.post('/tickets', form);
    setForm({ subject: '', description: '' });
    load();
  }

  async function transition(id, action) {
    const body = action === 'assign' ? { assignedTo: auth.user.username } : {};
    await api.put(`/tickets/${id}/${action}`, body);
    load();
  }

  return (
    <div>
      <div className="card">
        <h3>Raise a Ticket</h3>
        <form onSubmit={handleCreate} className="form-grid" style={{ alignItems: 'end' }}>
          <label><span>Subject</span><input value={form.subject} onChange={(e) => setForm((f) => ({ ...f, subject: e.target.value }))} required /></label>
          <label><span>Description</span><input value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} /></label>
          <button type="submit">Submit</button>
        </form>
      </div>

      <div className="card">
        <h3>Tickets</h3>
        <table>
          <thead><tr><th>Subject</th><th>Description</th><th>Status</th><th>Assigned To</th>{isAdmin && <th>Actions</th>}</tr></thead>
          <tbody>
            {tickets.map((t) => (
              <tr key={t.id}>
                <td>{t.subject}</td>
                <td>{t.description}</td>
                <td><span className={`badge ${t.status}`}>{t.status}</span></td>
                <td>{t.assignedTo || '—'}</td>
                {isAdmin && (
                  <td style={{ display: 'flex', gap: 6 }}>
                    {t.status === 'OPEN' && <button onClick={() => transition(t.id, 'assign')}>Assign to me</button>}
                    {t.status !== 'RESOLVED' && t.status !== 'CLOSED' && <button onClick={() => transition(t.id, 'resolve')}>Resolve</button>}
                    {t.status !== 'CLOSED' && <button className="secondary" onClick={() => transition(t.id, 'close')}>Close</button>}
                  </td>
                )}
              </tr>
            ))}
            {tickets.length === 0 && <tr><td colSpan={5}>No tickets.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

import { useEffect, useState } from 'react';
import api from '../../api/client';
import { useAuth } from '../../context/AuthContext';

export default function ChiefAdminTickets() {
  const { auth } = useAuth();
  const [tickets, setTickets] = useState([]);
  const [statusFilter, setStatusFilter] = useState('');

  async function load() {
    const { data } = await api.get('/tickets', { params: statusFilter ? { status: statusFilter } : {} });
    setTickets(data);
  }
  useEffect(() => { load(); }, [statusFilter]);

  async function transition(id, action) {
    const body = action === 'assign' ? { assignedTo: auth.user.username } : {};
    await api.put(`/tickets/${id}/${action}`, body);
    load();
  }

  return (
    <div className="card">
      <div className="topbar">
        <h3 style={{ margin: 0 }}>Support Tickets — All Clients</h3>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} style={{ width: 180 }}>
          <option value="">All statuses</option>
          <option value="OPEN">Open</option>
          <option value="ASSIGNED">Assigned</option>
          <option value="RESOLVED">Resolved</option>
          <option value="CLOSED">Closed</option>
        </select>
      </div>
      <table>
        <thead>
          <tr>
            <th>Client</th><th>Subject</th><th>Description</th><th>Status</th><th>Assigned To</th><th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {tickets.map((t) => (
            <tr key={t.id}>
              <td>{t.Client?.clientName} ({t.Client?.clientCode})</td>
              <td>{t.subject}</td>
              <td>{t.description}</td>
              <td><span className={`badge ${t.status}`}>{t.status}</span></td>
              <td>{t.assignedTo || '—'}</td>
              <td style={{ display: 'flex', gap: 6 }}>
                {t.status === 'OPEN' && <button onClick={() => transition(t.id, 'assign')}>Assign to me</button>}
                {t.status !== 'RESOLVED' && t.status !== 'CLOSED' && <button onClick={() => transition(t.id, 'resolve')}>Resolve</button>}
                {t.status !== 'CLOSED' && <button className="secondary" onClick={() => transition(t.id, 'close')}>Close</button>}
              </td>
            </tr>
          ))}
          {tickets.length === 0 && <tr><td colSpan={6}>No tickets.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

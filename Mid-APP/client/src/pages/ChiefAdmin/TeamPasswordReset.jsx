import { useEffect, useState } from 'react';
import api from '../../api/client';
import SearchSelect from '../../components/SearchSelect';
import { useAuth } from '../../context/AuthContext';

export default function TeamPasswordReset() {
  const { auth } = useAuth();
  // MARKETING (no ADMIN role): only users of their own assigned clients - not
  // the Chief Admin team, and not each client's built-in chiefadmin support login.
  const isAdmin = (auth?.user?.roles || []).includes('ADMIN');
  const [teamUsers, setTeamUsers] = useState([]);
  const [teamUserId, setTeamUserId] = useState('');
  const [teamPassword, setTeamPassword] = useState('');
  const [teamMessage, setTeamMessage] = useState('');
  const [teamError, setTeamError] = useState('');

  const [clients, setClients] = useState([]);
  const [clientId, setClientId] = useState('');
  const [clientUsers, setClientUsers] = useState([]);
  const [clientUserId, setClientUserId] = useState('');
  const [clientPassword, setClientPassword] = useState('');
  const [clientMessage, setClientMessage] = useState('');
  const [clientError, setClientError] = useState('');

  useEffect(() => {
    if (isAdmin) api.get('/chief-admin-users').then((r) => setTeamUsers(r.data));
    api.get('/clients').then((r) => setClients(r.data.clients || []));
  }, []);

  useEffect(() => {
    setClientUserId('');
    setClientUsers([]);
    if (!clientId) return;
    api.get(`/clients/${clientId}/users`).then((r) => setClientUsers(isAdmin ? r.data : r.data.filter((u) => !u.isSystemUser)));
  }, [clientId]);

  async function handleResetTeamPassword(e) {
    e.preventDefault();
    setTeamError('');
    setTeamMessage('');
    if (!teamUserId || !teamPassword) {
      setTeamError('Select a Chief Admin user and enter a new password');
      return;
    }
    try {
      await api.put(`/chief-admin-users/${teamUserId}/reset-password`, { password: teamPassword });
      const user = teamUsers.find((u) => String(u.id) === String(teamUserId));
      setTeamMessage(`Password updated for ${user?.username}.`);
      setTeamPassword('');
    } catch (err) {
      setTeamError(err.response?.data?.message || 'Failed to reset password');
    }
  }

  async function handleResetClientPassword(e) {
    e.preventDefault();
    setClientError('');
    setClientMessage('');
    if (!clientId || !clientUserId || !clientPassword) {
      setClientError('Select a client, a user and enter a new password');
      return;
    }
    try {
      await api.put(`/clients/${clientId}/users/${clientUserId}/reset-password`, { password: clientPassword });
      const user = clientUsers.find((u) => String(u.id) === String(clientUserId));
      setClientMessage(`Password updated for ${user?.username}.`);
      setClientPassword('');
    } catch (err) {
      setClientError(err.response?.data?.message || 'Failed to reset password');
    }
  }

  return (
    <div>
      {isAdmin && (
      <div className="card">
        <h3>Reset Password — Chief Admin Team</h3>
        <form onSubmit={handleResetTeamPassword} className="form-grid" style={{ alignItems: 'end' }}>
          <div><span>Chief Admin User</span>
            <SearchSelect
              options={teamUsers.map((u) => ({ value: u.id, label: `${u.name || u.username} (${u.username})` }))}
              value={teamUserId}
              onChange={setTeamUserId}
              placeholder="Search team member…"
            />
          </div>
          <label><span>New Password</span>
            <input type="password" value={teamPassword} onChange={(e) => setTeamPassword(e.target.value)} required />
          </label>
          <button type="submit">Reset Password</button>
        </form>
        {teamError && <p className="error-text">{teamError}</p>}
        {teamMessage && <p style={{ color: '#166534' }}>{teamMessage}</p>}
      </div>
      )}

      <div className="card">
        <h3>Reset Password — Client Users</h3>
        <p style={{ fontSize: 13, color: '#64748b' }}>
          Pick a client first — only that client's own users are shown, so passwords are always
          reset against the right client code.{!isAdmin && ' You can reset users of the clients assigned to you.'}
        </p>
        <form onSubmit={handleResetClientPassword} className="form-grid" style={{ alignItems: 'end' }}>
          <div><span>Client</span>
            <SearchSelect
              options={clients.map((c) => ({ value: c.id, label: `${c.clientName} (${c.clientCode})` }))}
              value={clientId}
              onChange={setClientId}
              placeholder="Search client…"
            />
          </div>
          <div><span>User</span>
            <SearchSelect
              options={clientUsers.map((u) => ({ value: u.id, label: `${u.name || u.username} (${u.username})` }))}
              value={clientUserId}
              onChange={setClientUserId}
              placeholder={clientId ? 'Search user…' : 'Select a client first'}
            />
          </div>
          <label><span>New Password</span>
            <input type="password" value={clientPassword} onChange={(e) => setClientPassword(e.target.value)} required />
          </label>
          <button type="submit">Reset Password</button>
        </form>
        {clientError && <p className="error-text">{clientError}</p>}
        {clientMessage && <p style={{ color: '#166534' }}>{clientMessage}</p>}
      </div>
    </div>
  );
}

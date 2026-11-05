import { useEffect, useState } from 'react';
import api from '../../api/client';
import RoleCheckboxes, { CHIEF_ADMIN_ROLE_OPTIONS } from '../../components/RoleCheckboxes';

function blankUser() {
  return { username: '', password: '', name: '', roleNames: ['MARKETING'] };
}

export default function ChiefAdminUsers() {
  const [users, setUsers] = useState([]);
  const [userCount, setUserCount] = useState(1);
  const [userRows, setUserRows] = useState([blankUser()]);
  const [roleEdits, setRoleEdits] = useState({});
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  async function load() {
    const { data } = await api.get('/chief-admin-users');
    setUsers(data);
    setRoleEdits({});
  }
  useEffect(() => { load(); }, []);

  function handleUserCountChange(value) {
    const count = Math.max(1, Math.min(20, Number(value) || 1));
    setUserCount(count);
    setUserRows((rows) => {
      const next = rows.slice(0, count);
      while (next.length < count) next.push(blankUser());
      return next;
    });
  }

  function updateUserRow(index, field, value) {
    setUserRows((rows) => rows.map((row, i) => (i === index ? { ...row, [field]: value } : row)));
  }

  async function handleCreate(e) {
    e.preventDefault();
    setError('');
    setMessage('');
    for (const u of userRows) {
      if (!u.username || !u.password) {
        setError('Every user needs a username and password');
        return;
      }
      if (u.roleNames.length === 0) {
        setError('Every user needs at least one role');
        return;
      }
    }
    try {
      const { data } = await api.post('/chief-admin-users/bulk', { users: userRows });
      setMessage(`Created ${data.users.length} user(s): ${data.users.map((u) => u.username).join(', ')}`);
      setUserCount(1);
      setUserRows([blankUser()]);
      load();
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to create users');
    }
  }

  function rolesFor(u) {
    return roleEdits[u.id] ?? u.Roles?.map((r) => r.name) ?? [];
  }

  async function saveRoles(userId) {
    setError('');
    const roleNames = roleEdits[userId];
    if (!roleNames || roleNames.length === 0) {
      setError('A user must have at least one role');
      return;
    }
    try {
      await api.put(`/chief-admin-users/${userId}`, { roleNames });
      load();
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to update roles');
    }
  }

  async function toggleActive(u) {
    setError('');
    try {
      await api.put(`/chief-admin-users/${u.id}`, { active: !u.active });
      load();
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to update user');
    }
  }

  return (
    <div>
      <div className="card">
        <h3>Create Chief Admin Users</h3>
        <p style={{ fontSize: 13, color: '#64748b' }}>
          e.g. an <strong>ADMIN</strong> user with full access, or a <strong>MARKETING</strong> user who can onboard clients.
        </p>
        <form onSubmit={handleCreate}>
          <div className="form-grid">
            <label><span>Number of Users</span>
              <input type="number" min={1} max={20} value={userCount} onChange={(e) => handleUserCountChange(e.target.value)} />
            </label>
          </div>

          {userRows.map((u, i) => (
            <div className="form-grid" key={i} style={{ borderTop: '1px solid #eee', paddingTop: 10, alignItems: 'end' }}>
              <label><span>Username</span>
                <input value={u.username} onChange={(e) => updateUserRow(i, 'username', e.target.value)} required />
              </label>
              <label><span>Name</span>
                <input value={u.name} onChange={(e) => updateUserRow(i, 'name', e.target.value)} />
              </label>
              <label><span>Password</span>
                <input type="password" value={u.password} onChange={(e) => updateUserRow(i, 'password', e.target.value)} required />
              </label>
              <div><span>Roles</span>
                <RoleCheckboxes options={CHIEF_ADMIN_ROLE_OPTIONS} value={u.roleNames} onChange={(roleNames) => updateUserRow(i, 'roleNames', roleNames)} />
              </div>
            </div>
          ))}

          {error && <p className="error-text">{error}</p>}
          {message && <p style={{ color: '#166534' }}>{message}</p>}
          <button type="submit" style={{ marginTop: 16 }}>Create Users</button>
        </form>
      </div>

      <div className="card">
        <h3>Chief Admin Team</h3>
        <table>
          <thead><tr><th>Username</th><th>Name</th><th>Roles</th><th>Active</th><th></th></tr></thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id}>
                <td>{u.username}</td>
                <td>{u.name}</td>
                <td style={{ minWidth: 220 }}>
                  <RoleCheckboxes options={CHIEF_ADMIN_ROLE_OPTIONS} value={rolesFor(u)} onChange={(roleNames) => setRoleEdits((edits) => ({ ...edits, [u.id]: roleNames }))} />
                </td>
                <td>{u.active ? 'Yes' : 'No'}</td>
                <td style={{ display: 'flex', gap: 6 }}>
                  {roleEdits[u.id] && <button type="button" onClick={() => saveRoles(u.id)}>Save Roles</button>}
                  <button type="button" className="secondary" onClick={() => toggleActive(u)}>
                    {u.active ? 'Deactivate' : 'Activate'}
                  </button>
                </td>
              </tr>
            ))}
            {users.length === 0 && <tr><td colSpan={5}>No Chief Admin users yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

import { useEffect, useState } from 'react';
import api from '../../api/client';
import { SCREEN_CATALOG } from '../../components/Layout';

export default function RoleScreenDefaults() {
  const [roles, setRoles] = useState([]);
  const [defaults, setDefaults] = useState({});
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  async function load() {
    const { data } = await api.get('/role-screen-defaults');
    setRoles(data.roles);
    setDefaults(data.defaults);
  }
  useEffect(() => { load(); }, []);

  function toggle(role, key) {
    setDefaults((d) => {
      const current = d[role] || [];
      const next = current.includes(key) ? current.filter((k) => k !== key) : [...current, key];
      return { ...d, [role]: next };
    });
  }

  async function handleSave(role) {
    setError('');
    setMessage('');
    try {
      await api.put('/role-screen-defaults', { role, screens: defaults[role] || [] });
      setMessage(`Default screens for ${role} saved.`);
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to save');
    }
  }

  return (
    <div>
      <div className="card">
        <h3>Role → Screen Defaults</h3>
        <p style={{ fontSize: 13, color: '#64748b' }}>
          The platform-wide baseline for which screens each client-side role can see. Every client's own ADMIN
          can further restrict this for their own staff, but never go beyond what's enabled here. The ADMIN role
          itself always has full access and isn't listed — it's the role that does the restricting.
        </p>
        {error && <p className="error-text">{error}</p>}
        {message && <p style={{ color: '#166534' }}>{message}</p>}

        <table>
          <thead>
            <tr>
              <th>Role</th>
              {SCREEN_CATALOG.map((s) => <th key={s.key}>{s.label}</th>)}
              <th></th>
            </tr>
          </thead>
          <tbody>
            {roles.map((role) => (
              <tr key={role}>
                <td><strong>{role}</strong></td>
                {SCREEN_CATALOG.map((s) => (
                  <td key={s.key}>
                    <input
                      type="checkbox"
                      style={{ width: 'auto' }}
                      checked={(defaults[role] || []).includes(s.key)}
                      onChange={() => toggle(role, s.key)}
                    />
                  </td>
                ))}
                <td><button type="button" onClick={() => handleSave(role)}>Save</button></td>
              </tr>
            ))}
            {roles.length === 0 && <tr><td colSpan={SCREEN_CATALOG.length + 2}>Loading…</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

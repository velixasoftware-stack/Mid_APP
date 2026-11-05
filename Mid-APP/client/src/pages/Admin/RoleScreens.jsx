import { useEffect, useState } from 'react';
import api from '../../api/client';
import { SCREEN_CATALOG } from '../../components/Layout';

export default function RoleScreens() {
  const [roles, setRoles] = useState([]);
  const [defaults, setDefaults] = useState({});
  const [effective, setEffective] = useState({});
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  async function load() {
    const { data } = await api.get('/role-screens');
    setRoles(data.roles);
    setDefaults(data.defaults);
    setEffective(data.effective);
  }
  useEffect(() => { load(); }, []);

  // Each tick/untick saves straight away; on failure the box flips back.
  async function toggle(role, key) {
    const before = effective[role] || [];
    const next = before.includes(key) ? before.filter((k) => k !== key) : [...before, key];
    setEffective((d) => ({ ...d, [role]: next }));
    setError('');
    setMessage('');
    try {
      await api.put('/role-screens', { role, screens: next });
      const label = SCREEN_CATALOG.find((s) => s.key === key)?.label || key;
      setMessage(`Saved - ${label} ${next.includes(key) ? 'enabled' : 'removed'} for ${role}.`);
    } catch (err) {
      setEffective((d) => ({ ...d, [role]: before }));
      setError(err.response?.data?.message || 'Failed to save');
    }
  }

  return (
    <div>
      <div className="card">
        <h3>Staff Screen Access</h3>
        <p style={{ fontSize: 13, color: '#64748b' }}>
          Choose which screens your own FRONT_OFFICE / LAB_USER / MANAGER / MASTER_MANAGER staff can see.
          Tick or untick a screen - it saves straight away. Greyed-out screens aren't part of your plan for that
          role (ask Chief Admin to enable them). The ADMIN role always has full access.
        </p>
        {error && <p className="error-text">{error}</p>}
        {message && <p style={{ color: '#166534' }}>{message}</p>}

        <table>
          <thead>
            <tr>
              <th>Role</th>
              {SCREEN_CATALOG.map((s) => <th key={s.key}>{s.label}</th>)}
            </tr>
          </thead>
          <tbody>
            {roles.map((role) => (
              <tr key={role}>
                <td><strong>{role}</strong></td>
                {SCREEN_CATALOG.map((s) => {
                  const allowed = (defaults[role] || []).includes(s.key);
                  return (
                    <td key={s.key}>
                      <input
                        type="checkbox"
                        style={{ width: 'auto' }}
                        disabled={!allowed}
                        checked={allowed && (effective[role] || []).includes(s.key)}
                        onChange={() => toggle(role, s.key)}
                        title={allowed ? '' : 'Not included in your platform plan for this role'}
                      />
                    </td>
                  );
                })}
              </tr>
            ))}
            {roles.length === 0 && <tr><td colSpan={SCREEN_CATALOG.length + 1}>Loading…</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

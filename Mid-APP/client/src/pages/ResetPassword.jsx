import { useState } from 'react';
import api from '../api/client';

export default function ResetPassword() {
  const [form, setForm] = useState({ currentPassword: '', newPassword: '', confirmPassword: '' });
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  function update(field, value) { setForm((f) => ({ ...f, [field]: value })); }

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setMessage('');
    if (form.newPassword !== form.confirmPassword) {
      setError('New password and confirm password do not match');
      return;
    }
    try {
      await api.put('/auth/change-password', {
        currentPassword: form.currentPassword,
        newPassword: form.newPassword,
      });
      setMessage('Your password has been updated.');
      setForm({ currentPassword: '', newPassword: '', confirmPassword: '' });
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to update password');
    }
  }

  return (
    <div>
      <div className="card" style={{ maxWidth: 480 }}>
        <h3>Reset Password</h3>
        <p style={{ fontSize: 13, color: '#64748b' }}>Change your own login password.</p>
        <form onSubmit={handleSubmit} className="form-grid" style={{ gridTemplateColumns: '1fr' }}>
          <label><span>Current Password</span>
            <input type="password" value={form.currentPassword} onChange={(e) => update('currentPassword', e.target.value)} required />
          </label>
          <label><span>New Password</span>
            <input type="password" value={form.newPassword} onChange={(e) => update('newPassword', e.target.value)} required />
          </label>
          <label><span>Confirm New Password</span>
            <input type="password" value={form.confirmPassword} onChange={(e) => update('confirmPassword', e.target.value)} required />
          </label>
          <button type="submit">Update Password</button>
        </form>
        {error && <p className="error-text">{error}</p>}
        {message && <p style={{ color: '#166534' }}>{message}</p>}
      </div>
    </div>
  );
}

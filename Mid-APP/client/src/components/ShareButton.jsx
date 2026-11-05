import { useState } from 'react';
import api from '../api/client';

// A small "Share via WhatsApp / Email" control, shared by the Bill receipt
// and Lab report print screens - both just POST to their own /share endpoint
// with { channel, to }, so the UI (and the double-submit guard) is identical.
export default function ShareButton({ apiPath }) {
  const [open, setOpen] = useState(false);
  const [channel, setChannel] = useState('whatsapp');
  const [to, setTo] = useState('');
  const [sending, setSending] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  async function handleSend(e) {
    e.preventDefault();
    if (sending) return; // guard against a rapid double-submit
    setError('');
    setMessage('');
    setSending(true);
    try {
      const { data } = await api.post(apiPath, { channel, to: to.trim() || undefined });
      setMessage(data.mock
        ? 'No WhatsApp/email provider is configured yet, so this was simulated - ask Chief Admin to set one up under Integrations.'
        : 'Sent.');
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to share');
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="no-print" style={{ position: 'relative' }}>
      <button type="button" className="secondary" onClick={() => setOpen((v) => !v)}>Share</button>
      {open && (
        <div
          style={{
            position: 'absolute', right: 0, top: '110%', zIndex: 20, background: '#fff',
            border: '1px solid #e2e8f0', borderRadius: 10, padding: 14, width: 260,
            boxShadow: '0 8px 24px rgba(15,23,42,0.12)',
          }}
        >
          <form onSubmit={handleSend}>
            <label style={{ display: 'block', marginBottom: 8 }}>
              <span style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 4 }}>Channel</span>
              <select value={channel} onChange={(e) => setChannel(e.target.value)}>
                <option value="whatsapp">WhatsApp</option>
                <option value="email">Email</option>
              </select>
            </label>
            <label style={{ display: 'block', marginBottom: 8 }}>
              <span style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 4 }}>
                {channel === 'whatsapp' ? 'Mobile (optional, defaults to patient\'s own)' : 'Email (optional, defaults to patient\'s own)'}
              </span>
              <input value={to} onChange={(e) => setTo(e.target.value)} placeholder={channel === 'whatsapp' ? '10-digit mobile' : 'name@example.com'} />
            </label>
            {error && <p className="error-text" style={{ fontSize: 12 }}>{error}</p>}
            {message && <p style={{ fontSize: 12, color: '#166534' }}>{message}</p>}
            <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
              <button type="button" className="secondary" onClick={() => setOpen(false)}>Close</button>
              <button type="submit" disabled={sending}>{sending ? 'Sending…' : 'Send'}</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

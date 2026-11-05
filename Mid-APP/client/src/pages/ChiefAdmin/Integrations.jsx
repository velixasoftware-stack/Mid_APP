import { useEffect, useState } from 'react';
import api from '../../api/client';

function blankForm() {
  return {
    smtpHost: '', smtpPort: '', smtpUser: '', smtpPassword: '', smtpFromEmail: '', smtpSecure: false,
    whatsappPhoneNumberId: '', whatsappAccessToken: '',
    gmailClientId: '', gmailClientSecret: '', gmailRefreshToken: '', gmailSenderEmail: '',
  };
}

function blankTemplate() {
  return { name: '', channel: 'BOTH', header: '', description: '' };
}

export default function Integrations() {
  const [form, setForm] = useState(blankForm());
  const [status, setStatus] = useState({ smtpPasswordSet: false, whatsappAccessTokenSet: false, gmailClientSecretSet: false, gmailRefreshTokenSet: false });
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const [templates, setTemplates] = useState([]);
  const [templateForm, setTemplateForm] = useState(blankTemplate());
  const [templateError, setTemplateError] = useState('');

  async function load() {
    const { data } = await api.get('/notification-settings');
    setForm((f) => ({ ...f, ...data, smtpPassword: '', whatsappAccessToken: '', gmailClientSecret: '', gmailRefreshToken: '' }));
    setStatus(data);
  }
  async function loadTemplates() {
    const { data } = await api.get('/notification-templates');
    setTemplates(data);
  }
  useEffect(() => { load(); loadTemplates(); }, []);

  function update(field, value) { setForm((f) => ({ ...f, [field]: value })); }
  function updateTemplate(field, value) { setTemplateForm((f) => ({ ...f, [field]: value })); }

  async function handleSave(e) {
    e.preventDefault();
    setError('');
    setMessage('');
    try {
      const { data } = await api.put('/notification-settings', form);
      setStatus(data);
      setForm((f) => ({ ...f, smtpPassword: '', whatsappAccessToken: '', gmailClientSecret: '', gmailRefreshToken: '' }));
      setMessage('Integration settings saved.');
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to save settings');
    }
  }

  async function handleAddTemplate(e) {
    e.preventDefault();
    setTemplateError('');
    try {
      await api.post('/notification-templates', templateForm);
      setTemplateForm(blankTemplate());
      loadTemplates();
    } catch (err) {
      setTemplateError(err.response?.data?.message || 'Failed to save template');
    }
  }

  async function handleToggleTemplate(t) {
    await api.put(`/notification-templates/${t.id}`, { active: !t.active });
    loadTemplates();
  }

  async function handleDeleteTemplate(t) {
    await api.delete(`/notification-templates/${t.id}`);
    loadTemplates();
  }

  return (
    <div>
      <div className="card">
        <h3>Email (SMTP)</h3>
        <p style={{ fontSize: 13, color: '#64748b' }}>
          Used to email a self-registered client their Client Code and login details.
          {status.smtpPasswordSet && <strong style={{ color: '#166534' }}> Password is currently configured.</strong>}
        </p>
        <form onSubmit={handleSave} className="form-grid" style={{ alignItems: 'end' }}>
          <label><span>SMTP Host</span><input value={form.smtpHost} onChange={(e) => update('smtpHost', e.target.value)} placeholder="smtp.gmail.com" /></label>
          <label><span>SMTP Port</span><input type="number" value={form.smtpPort} onChange={(e) => update('smtpPort', e.target.value)} placeholder="587" /></label>
          <label><span>SMTP Username</span><input value={form.smtpUser} onChange={(e) => update('smtpUser', e.target.value)} /></label>
          <label><span>SMTP Password</span><input type="password" value={form.smtpPassword} onChange={(e) => update('smtpPassword', e.target.value)} placeholder={status.smtpPasswordSet ? '••••••••' : ''} /></label>
          <label><span>From Email</span><input value={form.smtpFromEmail} onChange={(e) => update('smtpFromEmail', e.target.value)} /></label>
          <label><span>Use TLS/SSL</span>
            <select value={form.smtpSecure ? 'yes' : 'no'} onChange={(e) => update('smtpSecure', e.target.value === 'yes')}>
              <option value="no">No</option><option value="yes">Yes</option>
            </select>
          </label>

          <h3 style={{ gridColumn: '1 / -1', marginBottom: 0 }}>Gmail (Gmail API)</h3>
          <p style={{ gridColumn: '1 / -1', fontSize: 13, color: '#64748b', margin: 0 }}>
            Sends mail through Google's Gmail API (OAuth2) instead of plain SMTP — create an OAuth2 Client ID
            in Google Cloud Console (Gmail API enabled) and generate a refresh token for the sending mailbox.
            When configured, Gmail API is used in preference to the SMTP settings above.
            {status.gmailClientSecretSet && status.gmailRefreshTokenSet && <strong style={{ color: '#166534' }}> Gmail API is currently configured.</strong>}
          </p>
          <label><span>Gmail Client ID</span><input value={form.gmailClientId} onChange={(e) => update('gmailClientId', e.target.value)} placeholder="xxxx.apps.googleusercontent.com" /></label>
          <label><span>Gmail Client Secret</span><input type="password" value={form.gmailClientSecret} onChange={(e) => update('gmailClientSecret', e.target.value)} placeholder={status.gmailClientSecretSet ? '••••••••' : ''} /></label>
          <label><span>Gmail Refresh Token</span><input type="password" value={form.gmailRefreshToken} onChange={(e) => update('gmailRefreshToken', e.target.value)} placeholder={status.gmailRefreshTokenSet ? '••••••••' : ''} /></label>
          <label><span>Gmail Sender Email</span><input value={form.gmailSenderEmail} onChange={(e) => update('gmailSenderEmail', e.target.value)} placeholder="noreply@yourlab.com" /></label>

          <h3 style={{ gridColumn: '1 / -1', marginBottom: 0 }}>WhatsApp (Cloud API)</h3>
          <p style={{ gridColumn: '1 / -1', fontSize: 13, color: '#64748b', margin: 0 }}>
            Used to WhatsApp a self-registered client their Client Code and login details.
            {status.whatsappAccessTokenSet && <strong style={{ color: '#166534' }}> Access token is currently configured.</strong>}
          </p>
          <label><span>Phone Number ID</span><input value={form.whatsappPhoneNumberId} onChange={(e) => update('whatsappPhoneNumberId', e.target.value)} /></label>
          <label><span>Access Token</span><input type="password" value={form.whatsappAccessToken} onChange={(e) => update('whatsappAccessToken', e.target.value)} placeholder={status.whatsappAccessTokenSet ? '••••••••' : ''} /></label>

          <button type="submit">Save Integration Settings</button>
        </form>
        {error && <p className="error-text">{error}</p>}
        {message && <p style={{ color: '#166534' }}>{message}</p>}
        <p style={{ fontSize: 12, color: '#94a3b8', marginTop: 12 }}>
          Leaving every email/WhatsApp integration blank keeps it in mock mode: confirmations are logged on the
          server instead of actually being sent, so client self-registration keeps working even before you
          configure this.
        </p>
      </div>

      <div className="card">
        <h3>Notification Templates</h3>
        <p style={{ fontSize: 13, color: '#64748b' }}>
          Define the Header (subject line / message title) and Description (body) used when notifying a client —
          e.g. a template named <code>CLIENT_WELCOME</code> is used for the login-details email/WhatsApp message
          sent right after self-registration. Use <code>{'{{clientCode}}'}</code>, <code>{'{{clientName}}'}</code>,{' '}
          <code>{'{{username}}'}</code>, <code>{'{{name}}'}</code> and <code>{'{{loginDetails}}'}</code> as placeholders.
        </p>
        <form onSubmit={handleAddTemplate} className="form-grid" style={{ alignItems: 'end' }}>
          <label><span>Template Name</span><input value={templateForm.name} onChange={(e) => updateTemplate('name', e.target.value)} placeholder="CLIENT_WELCOME" required /></label>
          <label><span>Channel</span>
            <select value={templateForm.channel} onChange={(e) => updateTemplate('channel', e.target.value)}>
              <option value="BOTH">Email + WhatsApp</option>
              <option value="EMAIL">Email only</option>
              <option value="WHATSAPP">WhatsApp only</option>
            </select>
          </label>
          <label style={{ gridColumn: '1 / -1' }}><span>Header</span>
            <input value={templateForm.header} onChange={(e) => updateTemplate('header', e.target.value)} placeholder="Welcome to HMS/LIMS, {{name}}!" required />
          </label>
          <label style={{ gridColumn: '1 / -1' }}><span>Description</span>
            <textarea rows={4} value={templateForm.description} onChange={(e) => updateTemplate('description', e.target.value)} placeholder={'Hello {{name}},\nYour account is ready.\n{{loginDetails}}'} required />
          </label>
          <button type="submit">Add Template</button>
        </form>
        {templateError && <p className="error-text">{templateError}</p>}

        <table>
          <thead><tr><th>Name</th><th>Channel</th><th>Header</th><th>Description</th><th>Active</th><th></th></tr></thead>
          <tbody>
            {templates.map((t) => (
              <tr key={t.id}>
                <td>{t.name}</td>
                <td>{t.channel}</td>
                <td>{t.header}</td>
                <td style={{ maxWidth: 260, whiteSpace: 'pre-wrap' }}>{t.description}</td>
                <td>{t.active ? 'Yes' : 'No'}</td>
                <td style={{ display: 'flex', gap: 6 }}>
                  <button type="button" className="secondary" onClick={() => handleToggleTemplate(t)}>{t.active ? 'Disable' : 'Enable'}</button>
                  <button type="button" className="danger" onClick={() => handleDeleteTemplate(t)}>Delete</button>
                </td>
              </tr>
            ))}
            {templates.length === 0 && <tr><td colSpan={6}>No templates yet — add one above.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

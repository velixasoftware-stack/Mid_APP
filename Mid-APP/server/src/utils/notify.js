const nodemailer = require('nodemailer');
const { NotificationSetting, NotificationTemplate } = require('../models');

async function getSettings() {
  const [settings] = await NotificationSetting.findOrCreate({ where: { id: 1 }, defaults: { id: 1 } });
  return settings;
}

/** Fetches an active template by its unique name (e.g. "CLIENT_WELCOME"), or null if not configured. */
async function getTemplate(name) {
  return NotificationTemplate.findOne({ where: { name, active: true } });
}

/** Replaces {{placeholder}} tokens in template text with values from `data`. */
function renderTemplate(text, data) {
  return text.replace(/{{\s*(\w+)\s*}}/g, (_, key) => (data[key] != null ? String(data[key]) : ''));
}

/**
 * Sends an email. Prefers Gmail API (OAuth2) when configured, then falls
 * back to generic SMTP, then to a logged "mock" send so calling flows (e.g.
 * self registration) never fail just because notifications aren't set up.
 */
async function sendEmail({ to, subject, html }) {
  if (!to) return { sent: false, reason: 'No recipient email' };
  const s = await getSettings();

  if (s.gmailClientId && s.gmailClientSecret && s.gmailRefreshToken && s.gmailSenderEmail) {
    try {
      const transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: {
          type: 'OAuth2',
          user: s.gmailSenderEmail,
          clientId: s.gmailClientId,
          clientSecret: s.gmailClientSecret,
          refreshToken: s.gmailRefreshToken,
        },
      });
      await transporter.sendMail({ from: s.gmailSenderEmail, to, subject, html });
      return { sent: true, via: 'gmail-api' };
    } catch (err) {
      console.error('Failed to send email via Gmail API:', err.message);
      return { sent: false, error: err.message };
    }
  }

  if (!s.smtpHost || !s.smtpUser || !s.smtpPassword) {
    console.log(`[notify:mock-email] to=${to} subject="${subject}"\n${html}`);
    return { sent: false, mock: true };
  }

  try {
    const transporter = nodemailer.createTransport({
      host: s.smtpHost,
      port: s.smtpPort || 587,
      secure: !!s.smtpSecure,
      auth: { user: s.smtpUser, pass: s.smtpPassword },
    });
    await transporter.sendMail({ from: s.smtpFromEmail || s.smtpUser, to, subject, html });
    return { sent: true, via: 'smtp' };
  } catch (err) {
    console.error('Failed to send email:', err.message);
    return { sent: false, error: err.message };
  }
}

/**
 * Sends a WhatsApp message via the WhatsApp Cloud API. Falls back to a
 * logged "mock" send when it isn't configured yet.
 */
async function sendWhatsApp({ to, message }) {
  if (!to) return { sent: false, reason: 'No recipient number' };
  const s = await getSettings();

  if (!s.whatsappPhoneNumberId || !s.whatsappAccessToken) {
    console.log(`[notify:mock-whatsapp] to=${to} message="${message}"`);
    return { sent: false, mock: true };
  }

  try {
    const url = `https://graph.facebook.com/v19.0/${s.whatsappPhoneNumberId}/messages`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${s.whatsappAccessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to,
        type: 'text',
        text: { body: message },
      }),
    });
    if (!res.ok) throw new Error(`WhatsApp API returned ${res.status}`);
    return { sent: true };
  } catch (err) {
    console.error('Failed to send WhatsApp message:', err.message);
    return { sent: false, error: err.message };
  }
}

module.exports = { getSettings, sendEmail, sendWhatsApp, getTemplate, renderTemplate };

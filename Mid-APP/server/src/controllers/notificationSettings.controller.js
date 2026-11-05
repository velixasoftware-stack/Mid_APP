const { getSettings } = require('../utils/notify');
const { NotificationSetting } = require('../models');

// GET /api/notification-settings  (Chief Admin, ADMIN role)
async function getNotificationSettings(req, res) {
  const s = await getSettings();
  return res.json({
    smtpHost: s.smtpHost || '',
    smtpPort: s.smtpPort || '',
    smtpUser: s.smtpUser || '',
    smtpFromEmail: s.smtpFromEmail || '',
    smtpSecure: s.smtpSecure,
    smtpPasswordSet: !!s.smtpPassword,
    whatsappPhoneNumberId: s.whatsappPhoneNumberId || '',
    whatsappAccessTokenSet: !!s.whatsappAccessToken,
    gmailClientId: s.gmailClientId || '',
    gmailSenderEmail: s.gmailSenderEmail || '',
    gmailClientSecretSet: !!s.gmailClientSecret,
    gmailRefreshTokenSet: !!s.gmailRefreshToken,
  });
}

// PUT /api/notification-settings
async function updateNotificationSettings(req, res) {
  const s = await getSettings();
  const {
    smtpHost, smtpPort, smtpUser, smtpPassword, smtpFromEmail, smtpSecure,
    whatsappPhoneNumberId, whatsappAccessToken,
    gmailClientId, gmailClientSecret, gmailRefreshToken, gmailSenderEmail,
  } = req.body;

  const updates = {
    smtpHost, smtpPort: smtpPort ? Number(smtpPort) : null, smtpUser, smtpFromEmail, smtpSecure: !!smtpSecure,
    whatsappPhoneNumberId, gmailClientId, gmailSenderEmail,
  };
  // Only overwrite secrets when a new value is actually provided, so saving
  // the form again doesn't blank out a previously-configured credential.
  if (smtpPassword) updates.smtpPassword = smtpPassword;
  if (whatsappAccessToken) updates.whatsappAccessToken = whatsappAccessToken;
  if (gmailClientSecret) updates.gmailClientSecret = gmailClientSecret;
  if (gmailRefreshToken) updates.gmailRefreshToken = gmailRefreshToken;

  await s.update(updates);
  return getNotificationSettings(req, res);
}

module.exports = { getNotificationSettings, updateNotificationSettings };

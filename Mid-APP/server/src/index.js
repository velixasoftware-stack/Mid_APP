require('dotenv').config();
const fs = require('fs');
const path = require('path');
const express = require('express');
require('express-async-errors'); // makes thrown/rejected errors in async route handlers reach the error middleware instead of crashing the process
const cors = require('cors');
const helmet = require('helmet');
const { sequelize } = require('./models');
const routes = require('./routes');
const { expireOverdueSubscriptions } = require('./controllers/subscription.controller');
const { backfillSystemUsers } = require('./controllers/client.controller');
const { seedDefaultPatientTitles } = require('./controllers/patientTitle.controller');
const { dropStaleDiskCopy, serveStoredFile, backfillStoredFiles } = require('./utils/fileStore');

const app = express();
const UPLOAD_ROOT = path.join(__dirname, '..', 'uploads');
fs.mkdirSync(UPLOAD_ROOT, { recursive: true });

app.use(helmet({
  // Disabled: the default CSP would block the Razorpay checkout script and
  // other external resources this app loads; a tuned CSP can be added later
  // if needed.
  contentSecurityPolicy: false,
  // Disabled: the client (Netlify) and this API are served from different
  // origins, and the client needs to load /uploads images (logos,
  // letterheads, signatures) cross-origin - the default policy would block that.
  crossOriginResourcePolicy: false,
}));
app.use(cors({ origin: process.env.CLIENT_URL || '*' }));
app.use(express.json({
  verify: (req, _res, buf) => { req.rawBody = buf.toString(); },
}));
app.use('/uploads', dropStaleDiskCopy, express.static(UPLOAD_ROOT), serveStoredFile); // disk cache first, then the database copy

app.get('/api/health', (_req, res) => res.json({ status: 'ok' }));
app.use('/api', routes);

// In production the built React app (Mid-APP/client/dist) is served by this same
// process, so the whole thing is reachable at one URL - no separate static
// host or CORS setup needed. Any path that isn't /api or /uploads falls
// through to index.html so React Router can handle client-side routes.
const CLIENT_DIST = path.join(__dirname, '..', '..', 'client', 'dist');
if (fs.existsSync(CLIENT_DIST)) {
  // Vite's /assets files carry a content hash in their name, so a browser can
  // keep them for a year - a new build gets new names. index.html must always
  // be re-checked so a deploy is picked up; the logos/icons can sit a day.
  app.use(express.static(CLIENT_DIST, {
    setHeaders(res, filePath) {
      if (filePath.includes(`${path.sep}assets${path.sep}`)) res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      else if (filePath.endsWith('.html')) res.setHeader('Cache-Control', 'no-cache');
      else res.setHeader('Cache-Control', 'public, max-age=86400');
    },
  }));
  app.get(/^(?!\/api|\/uploads).*/, (_req, res) => {
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(path.join(CLIENT_DIST, 'index.html'));
  });
}

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(err.status || 500).json({ message: err.message || 'Internal server error' });
});

const PORT = process.env.PORT || 4000;

async function start() {
  await sequelize.authenticate();
  await sequelize.sync(); // dev convenience; use real migrations in production
  // sync() above never alters an already-existing table, so a column added to a model after the
  // table was first created has to be added out-of-band here — idempotent, safe to run every boot.
  // Sent as one batched query (one round trip) instead of one query per
  // column - each round trip to a far-away database adds to every cold start.
  await sequelize.query([
    'ALTER TABLE parameter_master ADD COLUMN IF NOT EXISTS method VARCHAR(255)',
    'ALTER TABLE parameter_master ADD COLUMN IF NOT EXISTS sequence INTEGER',
    'ALTER TABLE client_role_screen ADD COLUMN IF NOT EXISTS "grantedScreens" JSON NOT NULL DEFAULT \'[]\'',
    'ALTER TABLE parameter_master ADD COLUMN IF NOT EXISTS active BOOLEAN NOT NULL DEFAULT true',
    'ALTER TABLE client_test_price ADD COLUMN IF NOT EXISTS active BOOLEAN NOT NULL DEFAULT true',
    'ALTER TABLE bill_item ADD COLUMN IF NOT EXISTS "packageId" INTEGER REFERENCES package(id) ON DELETE SET NULL',
    'ALTER TABLE sample ADD COLUMN IF NOT EXISTS remarks TEXT',
    'ALTER TABLE sample ADD COLUMN IF NOT EXISTS "remarksBig" BOOLEAN NOT NULL DEFAULT false',
    'ALTER TABLE patient ADD COLUMN IF NOT EXISTS "ageUnit" VARCHAR(255) DEFAULT \'Years\'',
    'ALTER TABLE parameter_normal_range ADD COLUMN IF NOT EXISTS "ageUnit" VARCHAR(255) DEFAULT \'Years\'',
    'ALTER TABLE bill ADD COLUMN IF NOT EXISTS "visitType" VARCHAR(255) DEFAULT \'WALK-IN\'',
    'ALTER TABLE bill ADD COLUMN IF NOT EXISTS "priority" VARCHAR(255) DEFAULT \'ROUTINE\'',
    'ALTER TABLE client_user ADD COLUMN IF NOT EXISTS department VARCHAR(255)',
    'ALTER TABLE client_user ADD COLUMN IF NOT EXISTS designation VARCHAR(255)',
    'ALTER TABLE client_user ADD COLUMN IF NOT EXISTS "signaturePath" VARCHAR(255)',
    'ALTER TABLE bill ADD COLUMN IF NOT EXISTS "dueAmount" DECIMAL(10,2) NOT NULL DEFAULT 0',
    'ALTER TABLE bill_discount ADD COLUMN IF NOT EXISTS "cancelledAt" TIMESTAMPTZ',
    'ALTER TABLE bill_discount ADD COLUMN IF NOT EXISTS "fromDueAmount" DECIMAL(10,2) NOT NULL DEFAULT 0',
    'ALTER TABLE client_user ADD COLUMN IF NOT EXISTS "isSystemUser" BOOLEAN NOT NULL DEFAULT false',
    'ALTER TABLE client ADD COLUMN IF NOT EXISTS "qrPaymentRequired" BOOLEAN NOT NULL DEFAULT true',
    'ALTER TABLE parameter_master ADD COLUMN IF NOT EXISTS description TEXT',
    'ALTER TABLE report ADD COLUMN IF NOT EXISTS "revokedAt" TIMESTAMPTZ',
    'ALTER TABLE report ADD COLUMN IF NOT EXISTS "revokedReason" VARCHAR(255)',
    'ALTER TABLE bill ADD COLUMN IF NOT EXISTS "gstPercent" DECIMAL(5,2) NOT NULL DEFAULT 0',
    'ALTER TABLE bill ADD COLUMN IF NOT EXISTS "cgstAmount" DECIMAL(10,2) NOT NULL DEFAULT 0',
    'ALTER TABLE bill ADD COLUMN IF NOT EXISTS "sgstAmount" DECIMAL(10,2) NOT NULL DEFAULT 0',
    'ALTER TABLE bill ADD COLUMN IF NOT EXISTS "taxAmount" DECIMAL(10,2) NOT NULL DEFAULT 0',
    'ALTER TABLE client ADD COLUMN IF NOT EXISTS "defaultGstPercent" DECIMAL(5,2) NOT NULL DEFAULT 0',
    'ALTER TABLE client ADD COLUMN IF NOT EXISTS "brandingName" VARCHAR(255)',
    'ALTER TABLE client ADD COLUMN IF NOT EXISTS "brandingAddress" VARCHAR(255)',
    'ALTER TABLE client ADD COLUMN IF NOT EXISTS "brandingMobile" VARCHAR(255)',
    'ALTER TABLE client ADD COLUMN IF NOT EXISTS "brandingEmail" VARCHAR(255)',
    'ALTER TABLE report ADD COLUMN IF NOT EXISTS "releasedByUserId" INTEGER',
    'ALTER TABLE client_user ADD COLUMN IF NOT EXISTS "signatureName" VARCHAR(255)',
    'ALTER TABLE sample ADD COLUMN IF NOT EXISTS "collectedBy" VARCHAR(255)',
    'ALTER TABLE sample ADD COLUMN IF NOT EXISTS "resultEnteredAt" TIMESTAMPTZ',
    'ALTER TABLE sample ADD COLUMN IF NOT EXISTS "resultEnteredBy" VARCHAR(255)',
    'ALTER TABLE report ADD COLUMN IF NOT EXISTS "verifiedBy" VARCHAR(255)',
    'ALTER TABLE report ADD COLUMN IF NOT EXISTS "releasedBy" VARCHAR(255)',
    'ALTER TABLE report ADD COLUMN IF NOT EXISTS "revokedBy" VARCHAR(255)',
    'ALTER TABLE test_master ADD COLUMN IF NOT EXISTS "testType" VARCHAR(255) NOT NULL DEFAULT \'REGULAR\'',
    'ALTER TABLE client_test_price ADD COLUMN IF NOT EXISTS "overrideChiefInactive" BOOLEAN NOT NULL DEFAULT false',
    'ALTER TABLE parameter_master ADD COLUMN IF NOT EXISTS "normalRangeText" TEXT',
    'ALTER TABLE parameter_master ADD COLUMN IF NOT EXISTS "normalRangeTextMale" TEXT',
    'ALTER TABLE parameter_master ADD COLUMN IF NOT EXISTS "normalRangeTextFemale" TEXT',
    // A clinic's private copy of a universal parameter's ranges (null = shared rows).
    'ALTER TABLE parameter_normal_range ADD COLUMN IF NOT EXISTS "clientId" INTEGER REFERENCES client(id) ON DELETE CASCADE',
    // One payor period may now have several invoices - drop the old unique
    // (payorId, month) index and keep a plain one for lookups.
    'DROP INDEX IF EXISTS payor_invoice_payor_id_month',
    'CREATE INDEX IF NOT EXISTS payor_invoice_payor_id_month_idx ON payor_invoice ("payorId", month)',
    'ALTER TABLE patient ADD COLUMN IF NOT EXISTS title VARCHAR(255)',
    'ALTER TABLE patient_title ADD COLUMN IF NOT EXISTS gender VARCHAR(255)',
    'ALTER TABLE parameter_normal_range ADD COLUMN IF NOT EXISTS "rangeText" TEXT',
    'ALTER TABLE parameter_normal_range ADD COLUMN IF NOT EXISTS "ageMaxUnit" VARCHAR(255)',
    // A range row for everyone was called "Any"; it's "All" now.
    'UPDATE parameter_normal_range SET gender = \'All\' WHERE gender = \'Any\'',
    'ALTER TABLE parameter_normal_range ALTER COLUMN gender SET DEFAULT \'All\'',
    'ALTER TABLE bill ADD COLUMN IF NOT EXISTS "reportToken" VARCHAR(64)',
    'CREATE UNIQUE INDEX IF NOT EXISTS bill_report_token_idx ON bill ("reportToken")',
    'ALTER TABLE client ADD COLUMN IF NOT EXISTS "reportTopMarginMm" INTEGER',
    'ALTER TABLE client ADD COLUMN IF NOT EXISTS "reportBottomMarginMm" INTEGER',
    // Client locations: which one a user works at, and where each bill/sample was made.
    'ALTER TABLE client_user ADD COLUMN IF NOT EXISTS "allLocations" BOOLEAN NOT NULL DEFAULT true',
    'ALTER TABLE client_user ADD COLUMN IF NOT EXISTS "locationId" INTEGER REFERENCES client_location(id) ON DELETE SET NULL',
    'ALTER TABLE bill ADD COLUMN IF NOT EXISTS "locationId" INTEGER REFERENCES client_location(id) ON DELETE SET NULL',
    'ALTER TABLE sample ADD COLUMN IF NOT EXISTS "locationId" INTEGER REFERENCES client_location(id) ON DELETE SET NULL',
    // Bills from before a client had locations belong to its Main location.
    'UPDATE bill b SET "locationId" = l.id FROM client_location l WHERE l."clientId" = b."clientId" AND l."isMain" AND b."locationId" IS NULL',
    'UPDATE sample s SET "locationId" = l.id FROM client_location l WHERE l."clientId" = s."clientId" AND l."isMain" AND s."locationId" IS NULL',
  ].join(';\n'));
  await seedDefaultPatientTitles();
  await backfillStoredFiles();
  await sequelize.query("ALTER TYPE enum_report_status ADD VALUE IF NOT EXISTS 'REVOKED'");
  await backfillSystemUsers();
  await expireOverdueSubscriptions();
  setInterval(() => {
    expireOverdueSubscriptions().catch((err) => console.error('expireOverdueSubscriptions failed:', err));
  }, 24 * 60 * 60 * 1000);

  app.listen(PORT, () => console.log(`HMS/LIMS API listening on port ${PORT}`));
}

start().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});

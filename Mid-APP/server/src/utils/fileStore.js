const fs = require('fs');
const path = require('path');
const { StoredFile } = require('../models');

const UPLOAD_ROOT = path.join(__dirname, '..', '..', 'uploads');

/**
 * Saves an uploaded image (logo, letterhead, signature) under
 * uploads/<clientId>/<name><ext> and returns its public URL.
 *
 * The database copy is the real one: the host's disk (Render) is wiped on
 * every deploy/restart, which used to make uploaded letterheads, logos and
 * signatures vanish. The disk copy is only a cache - serveStoredFile below
 * restores it from the database whenever it's missing.
 */
async function saveUpload(clientId, name, file) {
  const ext = path.extname(file.originalname) || '.png';
  const relPath = `${clientId}/${name}${ext}`;
  // Taken before the disk write, so this server's own fresh copy is never
  // older than the link's version stamp (see dropStaleDiskCopy).
  const version = Date.now();

  await StoredFile.upsert({ path: relPath, contentType: file.mimetype || null, data: file.buffer });
  try {
    fs.mkdirSync(path.join(UPLOAD_ROOT, String(clientId)), { recursive: true });
    fs.writeFileSync(path.join(UPLOAD_ROOT, relPath), file.buffer);
  } catch (err) {
    console.error('Upload disk cache write failed (database copy is saved):', err.message);
  }
  // The file name never changes between uploads, so a version stamp makes
  // browsers fetch the new image instead of showing their cached old one.
  return `/uploads/${relPath}?v=${version}`;
}

/**
 * Runs before the disk is checked: if the link's version stamp (?v=, the
 * upload time) is newer than the disk copy, that copy is stale - e.g. a newer
 * upload was made through another server sharing this database - so it's
 * dropped and the request falls through to the database copy below.
 */
function dropStaleDiskCopy(req, _res, next) {
  const version = Number(req.query.v);
  if (!version) return next();
  const relPath = decodeURIComponent(req.path.replace(/^\/+/, ''));
  if (!relPath || relPath.includes('..')) return next();
  try {
    const diskFile = path.join(UPLOAD_ROOT, relPath);
    if (fs.statSync(diskFile).mtimeMs < version) fs.unlinkSync(diskFile);
  } catch { /* no disk copy - nothing to drop */ }
  return next();
}

/** Express handler for /uploads/* requests the disk didn't have - served from the database. */
async function serveStoredFile(req, res, next) {
  const relPath = decodeURIComponent(req.path.replace(/^\/+/, ''));
  if (!relPath || relPath.includes('..')) return next();

  const file = await StoredFile.findOne({ where: { path: relPath } });
  if (!file) return next();

  try {
    fs.mkdirSync(path.dirname(path.join(UPLOAD_ROOT, relPath)), { recursive: true });
    fs.writeFileSync(path.join(UPLOAD_ROOT, relPath), file.data); // re-cache for the next request
  } catch { /* serving from the database still works */ }
  if (file.contentType) res.type(file.contentType);
  else res.type(path.extname(relPath));
  return res.send(file.data);
}

const CONTENT_TYPES = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml' };

/**
 * Copies any image still only on this machine's disk (uploaded before the
 * database copy existed) into the database. Run at boot; skips files the
 * database already has, so it only ever adds.
 */
async function backfillStoredFiles() {
  if (!fs.existsSync(UPLOAD_ROOT)) return;
  const known = new Set((await StoredFile.findAll({ attributes: ['path'], raw: true })).map((f) => f.path));
  for (const dir of fs.readdirSync(UPLOAD_ROOT, { withFileTypes: true })) {
    if (!dir.isDirectory()) continue;
    for (const name of fs.readdirSync(path.join(UPLOAD_ROOT, dir.name))) {
      const relPath = `${dir.name}/${name}`;
      const contentType = CONTENT_TYPES[path.extname(name).toLowerCase()];
      if (known.has(relPath) || !contentType) continue;
      const data = fs.readFileSync(path.join(UPLOAD_ROOT, relPath));
      await StoredFile.create({ path: relPath, contentType, data, createdBy: 'SYSTEM' });
    }
  }
}

module.exports = { UPLOAD_ROOT, saveUpload, dropStaleDiskCopy, serveStoredFile, backfillStoredFiles };

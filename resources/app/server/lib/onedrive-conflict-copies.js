'use strict';

/* OneDrive çakışma kopyası dedektörü (yalnız okur, hiçbir dosyayı değiştirmez).

   Ortak klasör PC'lere eşitlenen OneDrive klasörü olduğunda, iki cihaz aynı
   dosyayı eşitleme tamamlanmadan değiştirirse OneDrive kaybeden sürümü
   `<ad>-<BilgisayarAdı>.<uzantı>` olarak yan dosyaya ayırır. Buyer Log bu yan
   dosyayı okumaz; içindeki değişiklik görünmez kalır. Çok yazarlı ortak
   dosyalar docs/ai/SHARED_FOLDER_WRITERS.md içinde listelenir.

   Kural: aynı klasörde `<kök>.<uzantı>` varken `<kök>-<ek>.<uzantı>` adlı bir
   girdi olası çakışma kopyasıdır. Bilgisayar adları tire içerebildiği için
   (ör. DESKTOP-AB12) her tire konumu denenir. Sonuç Moderatöre "olası"
   olarak gösterilir; otomatik birleştirme veya silme yapılmaz. */

const fsp = require('fs/promises');
const path = require('path');
const { hubDirectories } = require('./hub-dirent');

// Çok yazarlı veya Moderatörler arası paylaşılan, sabit adlı dosyaların klasörleri.
const SCAN_DIRS = Object.freeze([
  '',
  'BUYER_LOG_SYNC/collection-permissions',
  'BUYER_LOG_SYNC/collection-workspaces/v1',
  'iam',
  'iam/derived',
  'iam/revisions',
  'master',
  'master/checkpoints',
  'business',
  'business/checkpoints',
  'model-images',
  'model-images/content-index',
]);
const IAM_REVISION_DIRS = 'iam/revisions';
const RECENT_REVISIONS = 20;
const DEFAULT_LIMIT = 200;
const SUFFIX = /^[A-Za-z0-9][A-Za-z0-9_-]{0,62}$/;

function splitExt(name) {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, ''];
}

/* Bir klasörün ad listesinden olası çakışma kopyalarını döndürür:
   [{ name, original }]. Geçici ve kilit girdileri yok sayılır. */
function findConflictCopies(names) {
  const present = new Set(names);
  const out = [];
  for (const name of names) {
    if (name.endsWith('.tmp') || name.includes('.write-lock') || name.startsWith('.')) continue;
    const [stem, ext] = splitExt(name);
    for (let at = stem.indexOf('-'); at > 0; at = stem.indexOf('-', at + 1)) {
      const original = stem.slice(0, at) + ext;
      if (original !== name && present.has(original) && SUFFIX.test(stem.slice(at + 1))) { out.push({ name, original }); break; }
    }
  }
  return out;
}

async function listNames(dir) {
  try { return await fsp.readdir(dir, { withFileTypes: true }); }
  catch (error) { if (error && (error.code === 'ENOENT' || error.code === 'ENOTDIR')) return null; throw error; }
}

async function scanConflictCopies(sharedRoot, { limit = DEFAULT_LIMIT } = {}) {
  const root = String(sharedRoot || '').trim();
  if (!root) return { configured: false, items: [], truncated: false, scannedFolders: 0 };
  const max = Math.max(1, Math.min(1000, Number(limit) || DEFAULT_LIMIT));
  const items = [];
  let scannedFolders = 0, truncated = false;
  const relDirs = [...SCAN_DIRS];
  const revisionEntries = await listNames(path.join(root, ...IAM_REVISION_DIRS.split('/')));
  if (revisionEntries) {
    const revisionDirs = await hubDirectories(path.join(root, ...IAM_REVISION_DIRS.split('/')),
      revisionEntries.filter(entry => /^\d{16}$/.test(entry.name)));
    for (const entry of revisionDirs.map(e => e.name).sort().slice(-RECENT_REVISIONS)) relDirs.push(`${IAM_REVISION_DIRS}/${entry}`);
  }
  for (const rel of relDirs) {
    const entries = await listNames(rel ? path.join(root, ...rel.split('/')) : root);
    if (!entries) continue;
    scannedFolders++;
    for (const copy of findConflictCopies(entries.map(entry => entry.name))) {
      if (items.length >= max) { truncated = true; break; }
      items.push({ path: rel ? `${rel}/${copy.name}` : copy.name, original: rel ? `${rel}/${copy.original}` : copy.original });
    }
    if (truncated) break;
  }
  return { configured: true, items, truncated, scannedFolders };
}

module.exports = { scanConflictCopies, findConflictCopies, SCAN_DIRS };

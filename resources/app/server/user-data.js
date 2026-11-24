'use strict';

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const zlib = require('zlib');
const readline = require('readline');
const { once } = require('events');
const { pipeline } = require('stream/promises');
const { createDurableFileRecovery } = require('./lib/durable-file-recovery');
const { SENSITIVE_KEY, isSensitiveBackupPath, isUpdaterControlPath, sanitizeSensitiveValue } = require('./lib/backup-sensitivity');

const PROJECT_ROOT = path.join(__dirname, '..');
const SERVER_DATA_ROOT = process.env.BUYER_LOG_SERVER_DATA_ROOT || path.join(__dirname, 'data');
const APP_DATA_ROOT = process.env.BUYER_LOG_DATA_ROOT || (process.env.APPDATA
  ? path.join(process.env.APPDATA, 'Buyer Log')
  : path.join(os.homedir(), '.buyer-log'));
const LOCAL_DATA_ROOT = process.env.BUYER_LOG_LOCAL_DATA_ROOT || (process.env.LOCALAPPDATA
  ? path.join(process.env.LOCALAPPDATA, 'BuyerLog')
  : APP_DATA_ROOT);
// Tek yerel kalıcı/shared günlük: UI bu dosyadan çalışır; ağ yalnız delta taşır.
const LOCAL_DB_FILE = process.env.BUYER_LOG_LOCAL_DB || path.join(LOCAL_DATA_ROOT, 'BuyerLogLocal.db');
const MODEL_FILES_ROOT = path.join(LOCAL_DATA_ROOT, 'model-files');
const COLLECTION_IMAGES_ROOT = path.join(LOCAL_DATA_ROOT, 'collection-images');
// v6.55 — Colour Code bazlı kalıcı QTX depo klasörü. Umbrella'dan indirilen
// QTX dosyaları buraya, {colourCode}.qtx adıyla yazılır; bir index (qtx-store.js)
// hangi Colour Code'un kayıtlı olduğunu ve dosya adını tutar.
const QTX_FILES_ROOT = path.join(LOCAL_DATA_ROOT, 'qtx-files');
const LOGS_ROOT = path.join(LOCAL_DATA_ROOT, 'logs');
// Portable overrides keep their established location. Without one, temp output
// and diagnostics use a private per-user subtree instead of system temp itself.
// The old temporary-write allowance remains separate for synthetic tools/recovery.
const TEMPORARY_WRITE_ROOT = process.env.BUYER_LOG_TEMP_ROOT || os.tmpdir();
const DEFAULT_TEMP_NAME = 'BuyerLog' + (typeof process.getuid === 'function' ? '-' + process.getuid() : '');
const TEMP_ROOT = process.env.BUYER_LOG_TEMP_ROOT || path.join(TEMPORARY_WRITE_ROOT, DEFAULT_TEMP_NAME);
const EMAIL_DRAFT_ROOT = path.join(TEMP_ROOT, 'BuyerLog-email-drafts');
function ensureOwnedTempRoot() {
  if (process.env.BUYER_LOG_TEMP_ROOT) {
    // Explicit portable overrides may intentionally use a user-configured junction.
    fs.mkdirSync(TEMP_ROOT, { recursive: true });
    return;
  }
  fs.mkdirSync(TEMP_ROOT, { recursive: true, mode: 0o700 });
  const stat = fs.lstatSync(TEMP_ROOT);
  if (!stat.isDirectory() || stat.isSymbolicLink()
    || typeof process.getuid === 'function' && stat.uid !== process.getuid()) {
    throw Object.assign(new Error('Buyer Log geçici klasörü güvenli değil. / Buyer Log temporary directory is unsafe.'), { code: 'UNSAFE_TEMP_ROOT' });
  }
}
function createTempFolder(prefix) {
  ensureOwnedTempRoot();
  return fs.mkdtempSync(path.join(TEMP_ROOT, prefix));
}
ensureOwnedTempRoot();
const CONFIG_PATH = process.env.BUYER_LOG_CONFIG_PATH || path.join(PROJECT_ROOT, 'config.json');

const BACKUP_FORMAT = 'buyer-log-backup';
const LEGACY_BACKUP_SCHEMA_VERSION = 1;
const BACKUP_SCHEMA_VERSION = 2;
const BACKUP_CHUNK_BYTES = 256 * 1024;
const MAX_BACKUP_FILES = 5000;
const MAX_BACKUP_BYTES = 512 * 1024 * 1024;
// Kaynak görseller tabloya ham biçimde bağlanır. Bu yalnız bir güvenlik ve
// depolama tavanıdır; istemci/sunucu görseli yeniden kodlamaz.
const RAW_COLLECTION_IMAGE_MAX_BYTES = 50 * 1024 * 1024;
const DEFAULT_COLLECTION_IMAGE_LIMIT_KB = 5;
const MIN_COLLECTION_IMAGE_LIMIT_KB = 1;
const MAX_COLLECTION_IMAGE_LIMIT_KB = 1024;
const MODEL_IMAGE_SETTINGS_FILE = path.join(LOCAL_DATA_ROOT, 'model-image-settings.json');
// v3 forces images previously optimized for the old 15 KB target through the
// one-time migration again, even when their current byte size is below 15 KB.
const COLLECTION_IMAGE_OPTIMIZATION_VERSION = 3;
function isInside(root, target) {
  const relative = path.relative(path.resolve(root), path.resolve(target));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}
// Test ve araç alt süreçleri çoğunlukla yalnız geçici bir SERVER_DATA_ROOT
// verir. O durumda kurtarma kaydını gerçek kullanıcının LocalAppData alanına
// koymak, test silinince geçersiz hedefli bir intent bırakır. Geçici kök de
// geçicidir; günlük onun yanında kalır ve test temizliğiyle birlikte gider.
const WRITE_RECOVERY_ROOT = !process.env.BUYER_LOG_LOCAL_DATA_ROOT && isInside(TEMPORARY_WRITE_ROOT, SERVER_DATA_ROOT)
  ? path.join(SERVER_DATA_ROOT, '.buyerlog-write-recovery')
  : path.join(LOCAL_DATA_ROOT, 'write-recovery');
const durableRoots = [PROJECT_ROOT, SERVER_DATA_ROOT, APP_DATA_ROOT, LOCAL_DATA_ROOT, EMAIL_DRAFT_ROOT];
const durableFileRecovery = createDurableFileRecovery({
  recoveryRoot: WRITE_RECOVERY_ROOT,
  allowedRoots: durableRoots,
});
const startupWriteRecovery = durableFileRecovery.recoverSync();
if (startupWriteRecovery.conflicts || startupWriteRecovery.errors.length) {
  console.error('[DATA_INTEGRITY] Unfinished write recovery needs attention:', startupWriteRecovery);
} else if (startupWriteRecovery.recovered) {
  console.warn(`[DATA_INTEGRITY] ${startupWriteRecovery.recovered} unfinished local write(s) recovered.`);
}
const temporaryRecoveryWriters = new Map();
function durableWriterFor(file) {
  const target = path.resolve(file);
  if (durableRoots.some(root => isInside(root, target))) return durableFileRecovery;
  if (!isInside(TEMPORARY_WRITE_ROOT, target)) throw Object.assign(new Error(`Kalıcı yazma hedefi izin verilen veri alanlarının dışında: ${target}`), { code: 'DATA_INTEGRITY_ERROR' });
  const folder = path.dirname(target);
  if (!temporaryRecoveryWriters.has(folder)) {
    const writer = createDurableFileRecovery({ recoveryRoot: path.join(folder, '.buyerlog-write-recovery'), allowedRoots: [folder] });
    writer.recoverSync(); temporaryRecoveryWriters.set(folder, writer);
  }
  return temporaryRecoveryWriters.get(folder);
}
function normalizeModelImageLimitKb(value) {
  const parsed = Math.round(Number(value));
  if (!Number.isFinite(parsed)) return DEFAULT_COLLECTION_IMAGE_LIMIT_KB;
  return Math.max(MIN_COLLECTION_IMAGE_LIMIT_KB, Math.min(MAX_COLLECTION_IMAGE_LIMIT_KB, parsed));
}
function getModelImageSettings() {
  let maxKb = DEFAULT_COLLECTION_IMAGE_LIMIT_KB;
  try {
    const saved = JSON.parse(fs.readFileSync(MODEL_IMAGE_SETTINGS_FILE, 'utf8'));
    maxKb = normalizeModelImageLimitKb(saved && saved.maxKb);
  } catch (_) {}
  return { maxKb, maxBytes: maxKb * 1024 };
}
function saveModelImageSettings(value) {
  const maxKb = normalizeModelImageLimitKb(value && typeof value === 'object' ? value.maxKb : value);
  const settings = { maxKb, maxBytes: maxKb * 1024, updatedAt: new Date().toISOString() };
  atomicWriteJson(MODEL_IMAGE_SETTINGS_FILE, settings);
  return settings;
}

function ensureDir(dir) { fs.mkdirSync(dir, { recursive: true }); }
function purgeExpiredModelFiles(nowMs = Date.now()) {
  const RETENTION_MS = 365 * 24 * 60 * 60 * 1000;
  ensureDir(MODEL_FILES_ROOT);
  const indexFile = path.join(MODEL_FILES_ROOT, 'index.json');
  let index = [];
  for (const file of [indexFile, indexFile + '.bak']) {
    if (!fs.existsSync(file)) continue;
    try { const parsed = JSON.parse(fs.readFileSync(file, 'utf8')); if (Array.isArray(parsed)) { index = parsed; break; } } catch (_) {}
  }
  if (!index.length) return { deletedFiles: 0, deletedBytes: 0 };
  const keep = [];
  let deletedFiles = 0, deletedBytes = 0;
  for (const item of index) {
    const created = Date.parse(String(item && item.createdAt || ''));
    if (!Number.isFinite(created) || nowMs - created < RETENTION_MS) { keep.push(item); continue; }
    try {
      const full = resolveStoredFile(MODEL_FILES_ROOT, item.storedName);
      try { fs.unlinkSync(full); } catch (err) { if (err && err.code !== 'ENOENT') throw err; }
      if (fs.existsSync(full)) { keep.push(item); continue; }
      deletedFiles += 1; deletedBytes += Number(item.size) || 0;
    } catch (_) { keep.push(item); }
  }
  if (deletedFiles) atomicWriteJson(indexFile, keep);
  return { deletedFiles, deletedBytes };
}
function isSafeRelative(rel) {
  if (!rel || typeof rel !== 'string') return false;
  const normalized = rel.replace(/\\/g, '/');
  return !path.isAbsolute(rel) && !normalized.startsWith('../') && !normalized.includes('/../') && normalized !== '..' && !normalized.includes('\0');
}
function sha256(buffer) { return crypto.createHash('sha256').update(buffer).digest('hex'); }
const OPTIONAL_SYNC_ERROR_CODES = new Set(['EPERM', 'EINVAL', 'ENOSYS', 'ENOTSUP', 'EOPNOTSUPP']);
function syncFileBestEffort(fd) {
  try { fs.fsyncSync(fd); return true; }
  catch (err) {
    // Windows, OneDrive and some network/security-filtered file systems can reject
    // fsync even though the writable file handle and subsequent rename are valid.
    // The data has already been written; continue with atomic replacement only for
    // unsupported/permission-style sync errors. Real I/O failures still propagate.
    if (err && OPTIONAL_SYNC_ERROR_CODES.has(err.code)) return false;
    throw err;
  }
}
function atomicWriteBuffer(file, buffer) {
  durableWriterFor(file).replaceSync(file, buffer);
}
function atomicWriteJson(file, value) { atomicWriteBuffer(file, Buffer.from(JSON.stringify(value, null, 2), 'utf8')); }

/* ===================================================================
   v7.21 — ASENKRON ATOMİK YAZMA

   Saha bulgusu (kullanıcı): "100 kişi programda düzenlemeler yaptığı
   senaryoda ... zincirleme şekilde kullanıcılar birbirinin güncellemelerini
   bekleyecekse bu çalışılmaz bir sistem olur."

   Ölçüldü: 50.000 satırlık bir Koleksiyon sayfasının kaydedilmesi Node'un
   olay döngüsünü 237 ms boyunca TAMAMEN bloke ediyordu. O süre boyunca
   sunucu hiçbir isteğe yanıt vermiyor — CP'ye de, Overview'a da, diğer
   kullanıcılara da. Tek kullanıcının kaydı bütün ekibi durduruyordu.

   Bu sürüm aynı atomik yazma sözleşmesini asenkron olarak sunar. Davranış
   birebir korunur: geçici dosyaya yaz → fsync (desteklenmiyorsa tolere et)
   → varsa .bak kopyası → atomik rename (olmazsa kopyala). Değişen tek şey,
   bu adımlar sırasında olay döngüsünün serbest kalması.

   Mevcut eşzamanlı çağıranlar OLDUĞU GİBİ bırakıldı: bu yol yalnız ölçülmüş
   bir darboğazın bulunduğu yerde kullanılır. Bütün yazmaları topluca
   asenkronlaştırmak, sıralama garantisine dayanan yolları sessizce bozardı.
   =================================================================== */
async function syncFileHandleBestEffort(handle) {
  try { await handle.sync(); return true; }
  catch (err) {
    if (err && OPTIONAL_SYNC_ERROR_CODES.has(err.code)) return false;
    throw err;
  }
}
async function atomicWriteBufferAsync(file, buffer) {
  await durableWriterFor(file).replace(file, buffer);
}
async function atomicWriteJsonAsync(file, value) {
  // JSON.stringify tek başına da bloke eder; büyük yükte bunu bir sonraki
  // tick'e bırakmak, bekleyen isteklerin araya girmesine izin verir.
  await new Promise(resolve => setImmediate(resolve));
  const buffer = Buffer.from(JSON.stringify(value, null, 2), 'utf8');
  await atomicWriteBufferAsync(file, buffer);
}
function safeFilename(value, fallback = 'file') {
  const out = path.basename(String(value || fallback)).replace(/[\r\n"\\/:*?<>|]/g, '_').trim();
  return out || fallback;
}
function resolveStoredFile(root, storedName) {
  const raw = String(storedName || '');
  const normalized = raw.replace(/\\/g, '/');
  if (!normalized || normalized.includes('\0') || normalized !== path.posix.basename(normalized)) throw new Error('Geçersiz depolama dosyası yolu.');
  const base = path.resolve(root);
  const full = path.resolve(base, normalized);
  if (!full.startsWith(base + path.sep)) throw new Error('Depolama dosyası izin verilen klasörün dışında.');
  return full;
}
function walkFiles(root, options = {}) {
  if (!fs.existsSync(root)) return [];
  const excludedTop = new Set(options.excludeTop || []);
  const tolerateMissing = options.tolerateMissing === true;
  const out = [];
  const isTransientMissing = err => err && (err.code === 'ENOENT' || err.code === 'ENOTDIR');
  function visit(dir, relBase = '') {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
    catch (err) {
      if (tolerateMissing && isTransientMissing(err)) return;
      throw err;
    }
    for (const entry of entries) {
      if (!relBase && excludedTop.has(entry.name)) continue;
      const full = path.join(dir, entry.name);
      const rel = path.join(relBase, entry.name).replace(/\\/g, '/');
      if (entry.isSymbolicLink()) continue;
      if (options.skipSensitive && (isSensitiveBackupPath(rel) || isUpdaterControlPath(rel))) continue;
      if (entry.isDirectory()) {
        visit(full, rel);
        continue;
      }
      if (!entry.isFile() || /\.tmp$/i.test(entry.name)) continue;
      try { out.push({ full, rel, stat: fs.statSync(full) }); }
      catch (err) {
        if (tolerateMissing && isTransientMissing(err)) continue;
        throw err;
      }
    }
  }
  visit(root);
  return out;
}
// skipSensitive: kullanıcı/şifre hash deposu, audit, oturum sırları, AI/database
// kimlik bilgileri ve bunları çözen anahtar dosyaları eski .blgbackup zincirine
// HİÇ girmez. Aynı filtre restore'da da geçerlidir: bu dosyalar yedekten yazılmaz,
// mevcut olanlar silinmez/geri alınmaz (bkz. lib/backup-sensitivity.js).
function scopeDefinitions() {
  return {
    serverData: { root: SERVER_DATA_ROOT, excludeTop: ['logs', 'email-drafts', 'model-files', 'collection-images'], skipSensitive: true },
    appData: { root: APP_DATA_ROOT, excludeTop: APP_DATA_ROOT === LOCAL_DATA_ROOT ? ['auth', 'logs', 'model-files', 'collection-images'] : ['auth'], skipSensitive: true },
    modelFiles: { root: MODEL_FILES_ROOT, excludeTop: [], skipSensitive: true },
    collectionImages: { root: COLLECTION_IMAGES_ROOT, excludeTop: [], skipSensitive: true },
  };
}
function isProtectedRestorePath(scope, rel) {
  if (scope === 'config') return false;
  const def = scopeDefinitions()[scope];
  const normalized = String(rel || '').replace(/\\/g, '/');
  return Boolean(def && (def.excludeTop.includes(normalized.split('/')[0]) || isSensitiveBackupPath(normalized) || isUpdaterControlPath(normalized)));
}
// config.json dış parola hash'i ve oturum imza sırrını taşır; yedeğe sırsız girer.
function sanitizedConfigBuffer() {
  // This is an authoritative backup member. An unreadable/corrupt config must
  // stop the backup rather than silently substituting an empty object.
  const parsed = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  return Buffer.from(JSON.stringify(sanitizeSensitiveValue(parsed), null, 2), 'utf8');
}
// Restore sırasında mevcut kurulumun sır alanları korunur; yedekteki (eski ya da
// elle hazırlanmış) parola hash'i/oturum sırrı bu makineye yazılamaz.
function mergeProtectedConfig(restoredBuffer) {
  let restored;
  try { restored = JSON.parse(Buffer.from(restoredBuffer).toString('utf8')); } catch (_) { return restoredBuffer; }
  let current = {};
  try { current = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')) || {}; } catch (_) {}
  function merge(target, existing) {
    const out = sanitizeSensitiveValue(target);
    if (!out || typeof out !== 'object' || Array.isArray(out) || !existing || typeof existing !== 'object' || Array.isArray(existing)) return out;
    for (const [key, value] of Object.entries(existing)) {
      if (SENSITIVE_KEY.test(key)) out[key] = value;
      else if (value && typeof value === 'object' && !Array.isArray(value)) out[key] = merge(out[key] && typeof out[key] === 'object' ? out[key] : {}, value);
    }
    return out;
  }
  return Buffer.from(JSON.stringify(merge(restored, current), null, 2), 'utf8');
}
function sanitizeLegacyBrowserStorage(storage) {
  const out = {};
  for (const [key, value] of Object.entries(storage && typeof storage === 'object' && !Array.isArray(storage) ? storage : {})) {
    if (SENSITIVE_KEY.test(key)) continue;
    const text = String(value == null ? '' : value);
    // Yalnız JSON nesne/dizi değerlerinin içindeki sır alanları ayıklanır; düz
    // değerler ("1.50", "true") olduğu gibi kalır ki geri yükleme veriyi değiştirmesin.
    let parsed = null;
    try { parsed = /^\s*[[{]/.test(text) ? JSON.parse(text) : null; } catch (_) {}
    out[key] = parsed && typeof parsed === 'object' ? JSON.stringify(sanitizeSensitiveValue(parsed)) : text;
  }
  return out;
}
function getUserDataInventory() {
  const scopes = scopeDefinitions();
  const result = Object.entries(scopes).map(([id, def]) => {
    const files = walkFiles(def.root, def);
    return { id, root: def.root, exists: fs.existsSync(def.root), fileCount: files.length, bytes: files.reduce((sum, f) => sum + f.stat.size, 0) };
  });
  const configExists = fs.existsSync(CONFIG_PATH);
  result.push({ id: 'config', root: CONFIG_PATH, exists: configExists, fileCount: configExists ? 1 : 0, bytes: configExists ? fs.statSync(CONFIG_PATH).size : 0 });
  const warnings = [];
  for (const [id, root] of [['logs', LOGS_ROOT], ['temp', TEMP_ROOT], ['emailDraftTemp', EMAIL_DRAFT_ROOT]]) {
    try {
      if (!process.env.BUYER_LOG_TEMP_ROOT && (id === 'temp' || id === 'emailDraftTemp')) {
        ensureOwnedTempRoot();
        if (fs.existsSync(root) && fs.lstatSync(root).isSymbolicLink()) throw Object.assign(new Error('Unsafe diagnostic root.'), { code: 'UNSAFE_TEMP_ROOT' });
      }
      const files = walkFiles(root, { tolerateMissing: true });
      result.push({ id, root, exists: fs.existsSync(root), available: true, fileCount: files.length,
        bytes: files.reduce((sum, file) => sum + file.stat.size, 0), backupIncluded: false });
    } catch (error) {
      // These scopes are diagnostic only, never authoritative backup members.
      // Preserve the failure as an explicit warning and unknown totals.
      warnings.push({ code: 'DIAGNOSTIC_INVENTORY_UNAVAILABLE', scope: id, errorCode: String(error.code || 'UNKNOWN'),
        message: { tr: 'Yedek dışı tanılama envanteri okunamadı.', en: 'Excluded diagnostic inventory could not be read.' } });
      result.push({ id, root, exists: fs.existsSync(root), available: false, fileCount: null, bytes: null, backupIncluded: false });
    }
  }
  result.push({ id: 'browserLocalStorage', root: 'browser://localStorage', exists: true, fileCount: null, bytes: null, serverReadable: false });
  return { roots: result, warnings, totalBackupBytes: result.filter(x => x.backupIncluded !== false && Number.isFinite(x.bytes)).reduce((s, x) => s + x.bytes, 0) };
}
function exportBackup({ appVersion = '', browserStorage = {} } = {}) {
  const files = [];
  let totalBytes = 0;
  for (const [scope, def] of Object.entries(scopeDefinitions())) {
    for (const file of walkFiles(def.root, def)) {
      const buffer = fs.readFileSync(file.full);
      totalBytes += buffer.length;
      if (files.length + 1 > MAX_BACKUP_FILES || totalBytes > MAX_BACKUP_BYTES) throw new Error('Yedek paketi güvenli dosya/boyut sınırını aşıyor.');
      files.push({ scope, path: file.rel, size: buffer.length, sha256: sha256(buffer), base64: buffer.toString('base64') });
    }
  }
  if (fs.existsSync(CONFIG_PATH)) {
    const buffer = sanitizedConfigBuffer();
    totalBytes += buffer.length;
    files.push({ scope: 'config', path: 'config.json', size: buffer.length, sha256: sha256(buffer), base64: buffer.toString('base64') });
  }
  const manifest = {
    format: BACKUP_FORMAT,
    schemaVersion: LEGACY_BACKUP_SCHEMA_VERSION,
    appVersion: String(appVersion || ''),
    createdAt: new Date().toISOString(),
    inventory: getUserDataInventory(),
    browserStorage: sanitizeLegacyBrowserStorage(browserStorage),
    // Boş kapsamlar da tam geri yüklemede hedefte sonradan oluşan dosyaları temizler.
    managedScopes: [...Object.keys(scopeDefinitions()), 'config'],
    files,
  };
  return zlib.gzipSync(Buffer.from(JSON.stringify(manifest), 'utf8'), { level: 9 });
}
function parseBackup(buffer) {
  let raw;
  try { raw = zlib.gunzipSync(buffer); }
  catch (_) { raw = buffer; }
  const manifest = JSON.parse(raw.toString('utf8'));
  if (!manifest || manifest.format !== BACKUP_FORMAT || manifest.schemaVersion !== LEGACY_BACKUP_SCHEMA_VERSION || !Array.isArray(manifest.files)) throw new Error('Geçersiz Buyer Log eski yedek dosyası.');
  return manifest;
}
function targetFor(scope, rel) {
  if (!isSafeRelative(rel)) throw new Error('Yedekte güvenli olmayan dosya yolu bulundu.');
  if (scope === 'config') {
    if (rel !== 'config.json') throw new Error('Geçersiz yapılandırma dosyası yolu.');
    return CONFIG_PATH;
  }
  const def = scopeDefinitions()[scope];
  if (!def) throw new Error(`Desteklenmeyen yedek kapsamı: ${scope}`);
  const full = path.resolve(def.root, rel);
  const root = path.resolve(def.root) + path.sep;
  if (!full.startsWith(root)) throw new Error('Yedek dosyası hedef klasörün dışına çıkıyor.');
  return full;
}
function restoreBackup(buffer) {
  const manifest = parseBackup(buffer);
  if (manifest.files.length > MAX_BACKUP_FILES) throw new Error('Yedekte çok fazla dosya var.');
  const decoded = [];
  let total = 0;
  for (const item of manifest.files) {
    if (!item || typeof item.scope !== 'string' || typeof item.path !== 'string' || typeof item.base64 !== 'string') throw new Error('Yedekte eksik dosya kaydı var.');
    const data = Buffer.from(item.base64, 'base64');
    total += data.length;
    if (total > MAX_BACKUP_BYTES) throw new Error('Yedek açıldığında güvenli boyut sınırını aşıyor.');
    if (Number(item.size) !== data.length || (item.sha256 && item.sha256 !== sha256(data))) throw new Error(`Yedek bütünlük kontrolü başarısız: ${item.path}`);
    const target = targetFor(item.scope, item.path);
    if (isProtectedRestorePath(item.scope, item.path)) continue;
    decoded.push({ ...item, data: item.scope === 'config' ? mergeProtectedConfig(data) : data, target });
  }
  const txRoot = createTempFolder('buyerlog-restore-');
  const stageRoot = path.join(txRoot, 'stage');
  const rollbackRoot = path.join(txRoot, 'rollback');
  ensureDir(stageRoot); ensureDir(rollbackRoot);
  const allowedScopes = new Set([...Object.keys(scopeDefinitions()), 'config']);
  const declaredScopes = Array.isArray(manifest.managedScopes) ? manifest.managedScopes : decoded.map(x => x.scope);
  const scopesInBackup = new Set(declaredScopes.map(String));
  for (const scope of scopesInBackup) if (!allowedScopes.has(scope)) throw new Error(`Desteklenmeyen yedek kapsamı: ${scope}`);
  const previous = [];
  try {
    for (const item of decoded) {
      const staged = path.join(stageRoot, item.scope, item.path);
      ensureDir(path.dirname(staged)); fs.writeFileSync(staged, item.data); item.staged = staged;
    }
    for (const scope of scopesInBackup) {
      if (scope === 'config') {
        if (fs.existsSync(CONFIG_PATH)) { const rb = path.join(rollbackRoot, 'config', 'config.json'); ensureDir(path.dirname(rb)); fs.copyFileSync(CONFIG_PATH, rb); previous.push({ target: CONFIG_PATH, rollback: rb }); }
        continue;
      }
      const def = scopeDefinitions()[scope];
      for (const file of walkFiles(def.root, def)) {
        const rb = path.join(rollbackRoot, scope, file.rel); ensureDir(path.dirname(rb)); fs.copyFileSync(file.full, rb); previous.push({ target: file.full, rollback: rb });
      }
    }
    // Yönetilen kapsamları yedekteki hâline eşitle.
    for (const scope of scopesInBackup) {
      if (scope === 'config') continue;
      const def = scopeDefinitions()[scope];
      for (const file of walkFiles(def.root, def)) fs.unlinkSync(file.full);
    }
    if (scopesInBackup.has('config') && fs.existsSync(CONFIG_PATH)) fs.unlinkSync(CONFIG_PATH);
    for (const item of decoded) atomicWriteBuffer(item.target, fs.readFileSync(item.staged));
    return { ok: true, restoredFiles: decoded.length, restoredBytes: total, browserStorage: sanitizeLegacyBrowserStorage(manifest.browserStorage), sourceAppVersion: manifest.appVersion || '', createdAt: manifest.createdAt || null };
  } catch (err) {
    try {
      for (const scope of scopesInBackup) {
        if (scope === 'config') { if (fs.existsSync(CONFIG_PATH)) fs.unlinkSync(CONFIG_PATH); continue; }
        const def = scopeDefinitions()[scope];
        for (const file of walkFiles(def.root, def)) fs.unlinkSync(file.full);
      }
      for (const item of previous) { ensureDir(path.dirname(item.target)); fs.copyFileSync(item.rollback, item.target); }
    } catch (_) {}
    throw err;
  } finally { fs.rmSync(txRoot, { recursive: true, force: true }); }
}


// ---- Stream tabanlı Buyer Log yedek formatı (schema v2) ----
// Yeni format gzip içinde satır-bazlı kayıtlardır. Dosyalar 256 KiB parçalar hâlinde
// yazıldığı için sunucu tüm yedeği veya tek bir büyük dosyayı belleğe almak zorunda kalmaz.
function backupSourceEntries() {
  const files = [];
  let totalBytes = 0;
  for (const [scope, def] of Object.entries(scopeDefinitions())) {
    for (const file of walkFiles(def.root, def)) {
      totalBytes += file.stat.size;
      files.push({ scope, path: file.rel, full: file.full, size: file.stat.size });
    }
  }
  if (fs.existsSync(CONFIG_PATH)) {
    const buffer = sanitizedConfigBuffer();
    totalBytes += buffer.length;
    files.push({ scope: 'config', path: 'config.json', buffer, size: buffer.length });
  }
  if (files.length > MAX_BACKUP_FILES || totalBytes > MAX_BACKUP_BYTES) throw new Error('Yedek paketi güvenli dosya/boyut sınırını aşıyor.');
  return { files, totalBytes };
}
async function writeBackupLine(stream, value) {
  const line = typeof value === 'string' ? value : JSON.stringify(value);
  if (!stream.write(line + '\n')) await once(stream, 'drain');
}
function tempBackupPath() {
  const root = createTempFolder('buyerlog-backup-');
  return { root, file: path.join(root, 'BuyerLog.blgbackup') };
}
async function exportBackupToFile({ appVersion = '', browserStorage = {}, onProgress = null } = {}) {
  const source = backupSourceEntries();
  const temp = tempBackupPath();
  const gzip = zlib.createGzip({ level: 9 });
  const output = fs.createWriteStream(temp.file, { flags: 'wx' });
  const completion = pipeline(gzip, output);
  let processedBytes = 0;
  try {
    await writeBackupLine(gzip, {
      record: 'manifest', format: BACKUP_FORMAT, schemaVersion: BACKUP_SCHEMA_VERSION,
      appVersion: String(appVersion || ''), createdAt: new Date().toISOString(),
      inventory: getUserDataInventory(), managedScopes: [...Object.keys(scopeDefinitions()), 'config'],
      fileCount: source.files.length, totalBytes: source.totalBytes,
    });
    const browserBuffer = Buffer.from(JSON.stringify(sanitizeLegacyBrowserStorage(browserStorage)), 'utf8');
    const browserHash = crypto.createHash('sha256');
    await writeBackupLine(gzip, { record: 'browserStart', size: browserBuffer.length });
    for (let offset = 0; offset < browserBuffer.length; offset += BACKUP_CHUNK_BYTES) {
      const chunk = browserBuffer.subarray(offset, Math.min(browserBuffer.length, offset + BACKUP_CHUNK_BYTES));
      browserHash.update(chunk);
      await writeBackupLine(gzip, { record: 'browserChunk', base64: chunk.toString('base64') });
    }
    await writeBackupLine(gzip, { record: 'browserEnd', sha256: browserHash.digest('hex') });
    for (let index = 0; index < source.files.length; index++) {
      const file = source.files[index];
      await writeBackupLine(gzip, { record: 'fileStart', scope: file.scope, path: file.path, size: file.size });
      const hash = crypto.createHash('sha256');
      let actualSize = 0;
      const chunks = file.buffer
        ? Array.from({ length: Math.ceil(file.buffer.length / BACKUP_CHUNK_BYTES) }, (_, i) => file.buffer.subarray(i * BACKUP_CHUNK_BYTES, (i + 1) * BACKUP_CHUNK_BYTES))
        : fs.createReadStream(file.full, { highWaterMark: BACKUP_CHUNK_BYTES });
      for await (const chunk of chunks) {
        actualSize += chunk.length; processedBytes += chunk.length; hash.update(chunk);
        await writeBackupLine(gzip, { record: 'fileChunk', base64: chunk.toString('base64') });
        if (typeof onProgress === 'function') onProgress({ processedBytes, totalBytes: source.totalBytes, fileIndex: index + 1, fileCount: source.files.length, path: file.path });
      }
      if (actualSize !== file.size) throw new Error(`Yedekleme sırasında dosya boyutu değişti: ${file.path}`);
      await writeBackupLine(gzip, { record: 'fileEnd', size: actualSize, sha256: hash.digest('hex') });
    }
    await writeBackupLine(gzip, { record: 'end', fileCount: source.files.length, totalBytes: source.totalBytes });
    gzip.end();
    await completion;
    const stat = fs.statSync(temp.file);
    return {
      path: temp.file, size: stat.size, fileCount: source.files.length, sourceBytes: source.totalBytes,
      cleanup: () => fs.rmSync(temp.root, { recursive: true, force: true }),
    };
  } catch (err) {
    try { gzip.destroy(); } catch (_) {}
    try { output.destroy(); } catch (_) {}
    try { await completion; } catch (_) {}
    fs.rmSync(temp.root, { recursive: true, force: true });
    throw err;
  }
}
async function peekBackupManifest(file) {
  const input = fs.createReadStream(file);
  const gunzip = zlib.createGunzip();
  input.pipe(gunzip);
  let text = '';
  try {
    for await (const chunk of gunzip) {
      text += chunk.toString('utf8');
      const nl = text.indexOf('\n');
      if (nl >= 0) return JSON.parse(text.slice(0, nl));
      if (text.length > 1024 * 1024) throw new Error('Yedek manifest kaydı beklenenden büyük.');
    }
  } finally { input.destroy(); gunzip.destroy(); }
  throw new Error('Yedek manifest kaydı bulunamadı.');
}
function atomicReplaceFromFile(target, sourceFile) {
  ensureDir(path.dirname(target));
  const tmp = `${target}.${process.pid}.${Date.now()}.${crypto.randomBytes(3).toString('hex')}.restore.tmp`;
  let fd = null;
  try {
    fs.copyFileSync(sourceFile, tmp);
    fd = fs.openSync(tmp, 'r+');
    syncFileBestEffort(fd);
  } catch (err) {
    if (fd != null) { try { fs.closeSync(fd); } catch (_) {} fd = null; }
    try { fs.unlinkSync(tmp); } catch (_) {}
    throw err;
  } finally {
    if (fd != null) { try { fs.closeSync(fd); } catch (_) {} }
  }
  if (fs.existsSync(target)) {
    try { fs.copyFileSync(target, target + '.bak'); } catch (_) {}
  }
  try { fs.renameSync(tmp, target); }
  catch (renameErr) {
    try { fs.copyFileSync(tmp, target); fs.unlinkSync(tmp); }
    catch (copyErr) { try { fs.unlinkSync(tmp); } catch (_) {} throw copyErr; }
  }
}
function applyStagedRestore(manifest, stagedItems, total, browserStorage, txRoot) {
  const rollbackRoot = path.join(txRoot, 'rollback');
  ensureDir(rollbackRoot);
  const allowedScopes = new Set([...Object.keys(scopeDefinitions()), 'config']);
  const declaredScopes = Array.isArray(manifest.managedScopes) ? manifest.managedScopes : stagedItems.map(x => x.scope);
  const scopesInBackup = new Set(declaredScopes.map(String));
  for (const scope of scopesInBackup) if (!allowedScopes.has(scope)) throw new Error(`Desteklenmeyen yedek kapsamı: ${scope}`);
  const previous = [];
  try {
    for (const scope of scopesInBackup) {
      if (scope === 'config') {
        if (fs.existsSync(CONFIG_PATH)) { const rb = path.join(rollbackRoot, 'config', 'config.json'); ensureDir(path.dirname(rb)); fs.copyFileSync(CONFIG_PATH, rb); previous.push({ target: CONFIG_PATH, rollback: rb }); }
        continue;
      }
      const def = scopeDefinitions()[scope];
      for (const file of walkFiles(def.root, def)) {
        const rb = path.join(rollbackRoot, scope, file.rel); ensureDir(path.dirname(rb)); fs.copyFileSync(file.full, rb); previous.push({ target: file.full, rollback: rb });
      }
    }
    for (const scope of scopesInBackup) {
      if (scope === 'config') continue;
      const def = scopeDefinitions()[scope];
      for (const file of walkFiles(def.root, def)) fs.unlinkSync(file.full);
    }
    if (scopesInBackup.has('config') && fs.existsSync(CONFIG_PATH)) fs.unlinkSync(CONFIG_PATH);
    for (const item of stagedItems) atomicReplaceFromFile(item.target, item.staged);
    return { ok: true, restoredFiles: stagedItems.length, restoredBytes: total, browserStorage, sourceAppVersion: manifest.appVersion || '', createdAt: manifest.createdAt || null };
  } catch (err) {
    try {
      for (const scope of scopesInBackup) {
        if (scope === 'config') { if (fs.existsSync(CONFIG_PATH)) fs.unlinkSync(CONFIG_PATH); continue; }
        const def = scopeDefinitions()[scope];
        for (const file of walkFiles(def.root, def)) fs.unlinkSync(file.full);
      }
      for (const item of previous) { ensureDir(path.dirname(item.target)); fs.copyFileSync(item.rollback, item.target); }
    } catch (_) {}
    throw err;
  }
}
async function restoreBackupV2FromFile(file) {
  const txRoot = createTempFolder('buyerlog-restore-v2-');
  const stageRoot = path.join(txRoot, 'stage'); ensureDir(stageRoot);
  const input = fs.createReadStream(file).pipe(zlib.createGunzip());
  const lines = readline.createInterface({ input, crlfDelay: Infinity });
  let manifest = null, current = null, browser = null, browserStorage = {}, total = 0, fileCount = 0, skippedCount = 0, sawEnd = false;
  const stagedItems = [];
  try {
    for await (const line of lines) {
      if (!line) continue;
      const rec = JSON.parse(line);
      if (sawEnd) throw new Error('Yedek bitiş kaydından sonra beklenmeyen veri bulundu.');
      if (!manifest) {
        if (!rec || rec.record !== 'manifest' || rec.format !== BACKUP_FORMAT || rec.schemaVersion !== BACKUP_SCHEMA_VERSION) throw new Error('Geçersiz Buyer Log v2 yedek manifesti.');
        manifest = rec;
        continue;
      }
      if (rec.record === 'browserStart') {
        if (browser) throw new Error('Yedekte yinelenen tarayıcı depolama kaydı var.');
        const staged = path.join(stageRoot, '_browser-storage.json');
        browser = { staged, fd: fs.openSync(staged, 'w'), size: 0, expectedSize: Number(rec.size) || 0, hash: crypto.createHash('sha256') };
      } else if (rec.record === 'browserChunk') {
        if (!browser || browser.fd == null) throw new Error('Tarayıcı depolama parçası başlangıç kaydı olmadan bulundu.');
        const data = Buffer.from(String(rec.base64 || ''), 'base64'); browser.size += data.length; browser.hash.update(data); fs.writeSync(browser.fd, data);
        if (browser.size > 100 * 1024 * 1024) throw new Error('Tarayıcı depolama verisi güvenli boyut sınırını aşıyor.');
      } else if (rec.record === 'browserEnd') {
        if (!browser || browser.fd == null) throw new Error('Tarayıcı depolama bitiş kaydı başlangıç kaydı olmadan bulundu.');
        fs.closeSync(browser.fd); browser.fd = null;
        if (browser.size !== browser.expectedSize || (rec.sha256 && rec.sha256 !== browser.hash.digest('hex'))) throw new Error('Tarayıcı depolama bütünlük kontrolü başarısız.');
        browserStorage = sanitizeLegacyBrowserStorage(JSON.parse(fs.readFileSync(browser.staged, 'utf8') || '{}'));
      } else if (rec.record === 'fileStart') {
        if (current) throw new Error('Yedekte iç içe dosya başlangıç kaydı bulundu.');
        if (++fileCount > MAX_BACKUP_FILES) throw new Error('Yedekte çok fazla dosya var.');
        const target = targetFor(rec.scope, rec.path);
        const staged = path.join(stageRoot, rec.scope, rec.path); ensureDir(path.dirname(staged));
        current = { scope: rec.scope, path: rec.path, target, staged, skip: isProtectedRestorePath(rec.scope, rec.path), fd: fs.openSync(staged, 'w'), size: 0, expectedSize: Number(rec.size), hash: crypto.createHash('sha256') };
      } else if (rec.record === 'fileChunk') {
        if (!current) throw new Error('Dosya parçası başlangıç kaydı olmadan bulundu.');
        const data = Buffer.from(String(rec.base64 || ''), 'base64'); current.size += data.length; total += data.length;
        if (total > MAX_BACKUP_BYTES) throw new Error('Yedek açıldığında güvenli boyut sınırını aşıyor.');
        current.hash.update(data); fs.writeSync(current.fd, data);
      } else if (rec.record === 'fileEnd') {
        if (!current) throw new Error('Dosya bitiş kaydı başlangıç kaydı olmadan bulundu.');
        fs.closeSync(current.fd); current.fd = null;
        const hash = current.hash.digest('hex');
        if (current.size !== current.expectedSize || Number(rec.size) !== current.size || (rec.sha256 && rec.sha256 !== hash)) throw new Error(`Yedek bütünlük kontrolü başarısız: ${current.path}`);
        if (current.skip) skippedCount += 1;
        else {
          if (current.scope === 'config') fs.writeFileSync(current.staged, mergeProtectedConfig(fs.readFileSync(current.staged)));
          stagedItems.push({ scope: current.scope, path: current.path, target: current.target, staged: current.staged });
        }
        current = null;
      } else if (rec.record === 'end') {
        if (current) throw new Error('Yedek dosya kaydı tamamlanmadan sona erdi.');
        if (!browser || browser.fd != null) throw new Error('Tarayıcı depolama kaydı tamamlanmadan yedek sona erdi.');
        if (Number(rec.fileCount) !== stagedItems.length + skippedCount || Number(rec.totalBytes) !== total) throw new Error('Yedek bitiş kaydındaki dosya sayısı veya boyut uyuşmuyor.');
        sawEnd = true;
      } else throw new Error(`Desteklenmeyen yedek kaydı: ${rec.record || '(boş)'}`);
    }
    if (!manifest || current || !browser || browser.fd != null || !sawEnd) throw new Error('Yedek dosyası eksik veya yarım kalmış.');
    if (Number(manifest.fileCount) !== stagedItems.length + skippedCount || Number(manifest.totalBytes) !== total) throw new Error('Yedek manifestindeki dosya sayısı veya boyut uyuşmuyor.');
    return applyStagedRestore(manifest, stagedItems, total, browserStorage, txRoot);
  } finally {
    if (current && current.fd != null) try { fs.closeSync(current.fd); } catch (_) {}
    if (browser && browser.fd != null) try { fs.closeSync(browser.fd); } catch (_) {}
    lines.close();
    fs.rmSync(txRoot, { recursive: true, force: true });
  }
}
async function restoreBackupFromFile(file) {
  const manifest = await peekBackupManifest(file).catch(() => null);
  if (manifest && manifest.record === 'manifest' && manifest.format === BACKUP_FORMAT && manifest.schemaVersion === BACKUP_SCHEMA_VERSION) return restoreBackupV2FromFile(file);
  // v2.71 ve öncesindeki tek-JSON gzip yedekleri için geriye uyumluluk.
  return restoreBackup(fs.readFileSync(file));
}

// ---- Collection images ----
const COLLECTION_IMAGES_INDEX = path.join(COLLECTION_IMAGES_ROOT, 'index.json');
const COLLECTION_IMAGES_OPTIMIZATION = path.join(COLLECTION_IMAGES_ROOT, 'optimization-v1.json');
/* İNDEKS ÖNBELLEĞİ. getCollectionImage her kimlik için çağrılır (dağıtım
   planı, ingest kararı, hover). Eskiden her çağrı index.json'u diskten okuyup
   parse ediyordu: 20.000 görsellik depoda 129 modelin yerel planı ~2,8 sn,
   1.000 model ~21 sn sunucu olay döngüsünü kilitliyordu. Artık dosya kimliği
   (inode + boyut + mtime) değişmedikçe tek parse yapılır. Önbellek yalnız
   birincil dosya geçerliyken tutulur; .bak'a düşüş eskisi gibi her seferinde
   diskten okunur. */
/* v8.0.15 — BELLEK OTORİTER İNDEKS + TEK UÇUŞLU ASENKRON KALICILAŞTIRMA.
   Saha profili (8.0.14): PLM görsel alımında HER görsel için bütün
   index.json parse ediliyor, pretty-print yazılıyor, fsync + iki rename +
   tam dosyayı geri okuyup SHA-256 yapılıyordu; hepsi ana iş parçacığında.
   Maliyet O(görsel × indeks boyutu): 4.708 indirme 2.000 sn, 3 indirmelik
   sessiz parti 11,7 sn olay döngüsünü kilitledi.

   SÖZLEŞME
   - Bellekteki indeks (imageIndexState) tek doğruluk kaynağıdır; kalıcı
     dosyadan yalnız temizken (bekleyen yazma yokken) ve dosya kimliği
     değiştiyse yeniden okunur. Kendi yazmalarımızdan sonra kimlik güncellenir:
     görsel başına yeniden parse yok.
   - Bir kayıt belleğe ANCAK görsel dosyası diske dayanıklı yazıldıktan sonra
     girer: eşzamanlı okuyucular (getCollectionImage, dağıtım planı, hover)
     dosyası olmayan bir kayıt görmez.
   - Senkron çağıranlar (elle yükleme, silme, sıfırlama) eskisi gibi dönmeden
     önce SENKRON ve dayanıklı yazar. Tek istisna: o anda asenkron bir yazma
     uçuştaysa aynı hedefe ikinci yazıcı açılmaz (kurtarma niyeti çakışır);
     değişiklik belleğe uygulanır ve uçuştaki yazma bitince aynı döngüde
     kalıcılaşır. Onay veren rotalar flushCollectionImageIndex'i bekler.
   - Toplu yollar (PLM alımı, paylaşılan/ASAS kurulum) dosyayı asenkron yazar,
     indeksi bellekte günceller ve imagemap bağlantısından ÖNCE bir kez
     flushCollectionImageIndex bekler. Unutulursa ya da iş yarıda kalırsa
     sınırlı gecikmeli güvenlik yazması (COLLECTION_IMAGE_INDEX_MAX_DELAY_MS)
     devreye girer.
   - Kalıcı yazma durable-file-recovery replace (asenkron) ile yapılır:
     .bak ve hazırlanmış-niyet (prepared-commit) güvenceleri aynen geçerli.
   - Çökme kurtarma: indeks ya eski ya yeni sürümdedir (niyet kurtarma).
     Dosyası yazılıp indekse kalıcılaşamamış görsellere hiçbir imagemap
     bağlantısı işaret etmez (bağlantı flush'tan sonra yazılır); bu kimlikler
     bir sonraki "eksikleri tamamla" turunda yeniden alınır. Yetim kalan
     dosyalar sonraki süreçte reconcileCollectionImageOrphans ile temizlenir. */
const COLLECTION_IMAGE_INDEX_MAX_DELAY_MS = 5000;
const COLLECTION_IMAGE_INDEX_RETRY_MAX_MS = 60000;
const COLLECTION_IMAGE_PROCESS_STARTED_AT = Date.now();
const COLLECTION_IMAGE_STORED_NAME = /^ci_\d+_[0-9a-f]{12}\.(?:jpg|png|webp|gif|img)$/;
let imageIndexState = null;
let indexDirtyGen = 0, indexPersistedGen = 0;
let indexFlushPromise = null, indexFlushTimer = null, indexFlushFailures = 0;
let orphanSweepScheduled = false;
const collectionImageIndexStats = { syncWrites: 0, asyncWrites: 0, diskLoads: 0 };
function collectionImageIndexSignature() {
  try { const st = fs.statSync(COLLECTION_IMAGES_INDEX); return `${st.ino}:${st.size}:${st.mtimeMs}`; }
  catch (_) { return ''; }
}
async function collectionImageIndexSignatureAsync() {
  try { const st = await fsp.stat(COLLECTION_IMAGES_INDEX); return `${st.ino}:${st.size}:${st.mtimeMs}`; }
  catch (_) { return ''; }
}
function collectionImageIndexPending() { return indexDirtyGen > indexPersistedGen || Boolean(indexFlushPromise); }
function indexStateFrom(items, signature, source) {
  return { signature, source, items, byId: new Map(items.filter(item => item && item.id).map(item => [item.id, item])) };
}
function loadCollectionImageIndexFromDisk(signature) {
  collectionImageIndexStats.diskLoads += 1;
  for (const file of [COLLECTION_IMAGES_INDEX, COLLECTION_IMAGES_INDEX + '.bak']) {
    if (!fs.existsSync(file)) continue;
    try {
      const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (!Array.isArray(parsed)) continue;
      // Önbellek kimliği yalnız birincil dosya geçerliyken tutulur; .bak'a
      // düşüşte her okuma (temizken) eskisi gibi diskten yapılır.
      const primary = file === COLLECTION_IMAGES_INDEX;
      return indexStateFrom(parsed, primary ? signature : '', primary ? 'primary' : 'bak');
    } catch (_) {}
  }
  return indexStateFrom([], '', 'none');
}
function cachedCollectionImageIndex() {
  ensureDir(COLLECTION_IMAGES_ROOT);
  if (imageIndexState && collectionImageIndexPending()) return imageIndexState;
  const signature = collectionImageIndexSignature();
  if (imageIndexState && signature && imageIndexState.signature === signature) return imageIndexState;
  imageIndexState = loadCollectionImageIndexFromDisk(signature);
  return imageIndexState;
}
// Çağıranlar diziyi değiştirip yazar: önbellek paylaşılmaz, sığ kopya döner.
function readCollectionImageIndex() { return cachedCollectionImageIndex().items.slice(); }
function scheduleCollectionImageIndexFlush(delayMs = COLLECTION_IMAGE_INDEX_MAX_DELAY_MS) {
  if (indexFlushTimer || indexFlushPromise) return;
  indexFlushTimer = setTimeout(() => {
    indexFlushTimer = null;
    startCollectionImageIndexFlush().catch(error => {
      console.error('[DATA_INTEGRITY] Model görseli indeksi kalıcılaştırılamadı; yeniden denenecek. / Collection image index flush failed; will retry:', error && error.message || error);
    });
  }, Math.max(0, delayMs));
  if (typeof indexFlushTimer.unref === 'function') indexFlushTimer.unref();
}
function startCollectionImageIndexFlush() {
  if (indexFlushTimer) { clearTimeout(indexFlushTimer); indexFlushTimer = null; }
  if (indexFlushPromise) return indexFlushPromise;
  const run = (async () => {
    while (indexDirtyGen > indexPersistedGen) {
      // Bekleyen istekler stringify'dan önce araya girebilsin.
      await new Promise(resolve => setImmediate(resolve));
      const state = imageIndexState, gen = indexDirtyGen;
      const buffer = Buffer.from(JSON.stringify(state.items, null, 2), 'utf8');
      await atomicWriteBufferAsync(COLLECTION_IMAGES_INDEX, buffer);
      collectionImageIndexStats.asyncWrites += 1;
      indexPersistedGen = Math.max(indexPersistedGen, gen);
      const signature = await collectionImageIndexSignatureAsync();
      if (imageIndexState === state) { state.signature = signature; state.source = 'primary'; }
    }
  })();
  indexFlushPromise = run.then(() => {
    indexFlushFailures = 0;
    indexFlushPromise = null;
  }, error => {
    indexFlushPromise = null;
    indexFlushFailures += 1;
    if (indexDirtyGen > indexPersistedGen) {
      scheduleCollectionImageIndexFlush(Math.min(COLLECTION_IMAGE_INDEX_RETRY_MAX_MS, 1000 * (2 ** Math.min(6, indexFlushFailures - 1))));
    }
    throw error;
  });
  return indexFlushPromise;
}
/* Çağrı anına kadarki bütün indeks değişiklikleri diske dayanıklı yazılınca
   çözülür. Başka bir yazma uçuştaysa onu bekler, ikinci yazıcı açmaz. */
async function flushCollectionImageIndex() {
  const target = indexDirtyGen;
  while (indexPersistedGen < target) await startCollectionImageIndexFlush();
}
function flushCollectionImageIndexSyncBestEffort() {
  if (!imageIndexState || indexFlushPromise || indexDirtyGen <= indexPersistedGen) return false;
  try {
    const gen = indexDirtyGen;
    atomicWriteJson(COLLECTION_IMAGES_INDEX, imageIndexState.items);
    collectionImageIndexStats.syncWrites += 1;
    indexPersistedGen = Math.max(indexPersistedGen, gen);
    return true;
  } catch (error) {
    console.error('[DATA_INTEGRITY] Kapanışta model görseli indeksi yazılamadı. / Collection image index could not be written on exit:', error && error.message || error);
    return false;
  }
}
process.once('exit', flushCollectionImageIndexSyncBestEffort);
/* Tek değişiklik kapısı. mutate(draft) draft.items/draft.byId üzerinde çalışır.
   defer=false (varsayılan): uçuşta yazma yoksa taslak SENKRON yazılır, başarı
   sonrası belleğe alınır; yazma hata verirse bellek değişmez (eski davranış).
   defer=true ya da uçuşta yazma varsa: bellek yerinde değişir, sınırlı
   gecikmeyle kalıcılaşır; çağıran gerekiyorsa flushCollectionImageIndex bekler. */
function mutateCollectionImageIndex(mutate, { defer = false } = {}) {
  const state = cachedCollectionImageIndex();
  if (defer || indexFlushPromise) {
    mutate(state);
    indexDirtyGen += 1;
    scheduleCollectionImageIndexFlush();
    return { durable: false };
  }
  const draft = { items: state.items.slice(), byId: new Map(state.byId) };
  mutate(draft);
  const gen = indexDirtyGen + 1;
  atomicWriteJson(COLLECTION_IMAGES_INDEX, draft.items);
  collectionImageIndexStats.syncWrites += 1;
  imageIndexState = { items: draft.items, byId: draft.byId, signature: collectionImageIndexSignature(), source: 'primary' };
  indexDirtyGen = gen; indexPersistedGen = gen;
  if (indexFlushTimer) { clearTimeout(indexFlushTimer); indexFlushTimer = null; }
  return { durable: true };
}
function addIndexItem(draft, item) { draft.items.push(item); draft.byId.set(item.id, item); }
function removeIndexItem(draft, id) {
  const position = draft.items.findIndex(item => item && item.id === id);
  if (position >= 0) draft.items.splice(position, 1);
  draft.byId.delete(id);
}
function writeCollectionImageIndex(items) {
  mutateCollectionImageIndex(draft => {
    draft.items = items.slice();
    draft.byId = new Map(draft.items.filter(item => item && item.id).map(item => [item.id, item]));
  });
}
/* Önceki süreçten kalan yetim görsel dosyaları (dosya yazıldı, indeks
   kalıcılaşmadan çöktü) temizlenir. Bilerek dar tutulur:
   - yalnız ci_<ms>_<12 hex>.<uzantı> adlı depo dosyaları,
   - yalnız bu süreç başlamadan ÖNCE değişmiş dosyalar (bu süreçte yazılan
     her dosya yazıldığı anda belleğe girer; geri yükleme yeni mtime yazar),
   - yalnız indeks temiz ve birincil dosyadan okunmuşken (.bak'a düşüş ya da
     bozuk indeks gerçek görselleri yetim gösterebilir),
   - yetim sayısı şüpheli derecede büyükse hiçbir şey silinmez. */
async function reconcileCollectionImageOrphans({ startedBeforeMs = COLLECTION_IMAGE_PROCESS_STARTED_AT - 60000 } = {}) {
  if (collectionImageIndexPending()) return { skipped: 'pending' };
  const state = cachedCollectionImageIndex();
  if (state.source !== 'primary') return { skipped: 'index-not-primary' };
  const known = new Set(state.items.map(item => String(item && item.storedName || '')).filter(Boolean));
  let names = [];
  try { names = await fsp.readdir(COLLECTION_IMAGES_ROOT); } catch (error) { if (error && error.code === 'ENOENT') return { removed: 0 }; throw error; }
  const candidates = [];
  for (const name of names) {
    if (!COLLECTION_IMAGE_STORED_NAME.test(name) || known.has(name)) continue;
    try { const st = await fsp.stat(path.join(COLLECTION_IMAGES_ROOT, name)); if (st.isFile() && st.mtimeMs < startedBeforeMs) candidates.push(name); }
    catch (_) {}
  }
  if (candidates.length > Math.max(200, state.items.length)) return { skipped: 'suspicious-orphan-count', orphans: candidates.length };
  // Tarama sırasında araya giren bir yazma indeksi değiştirmiş olabilir.
  if (collectionImageIndexPending() || cachedCollectionImageIndex() !== state) return { skipped: 'changed' };
  let removed = 0;
  for (const name of candidates) {
    try { await fsp.unlink(path.join(COLLECTION_IMAGES_ROOT, name)); removed += 1; } catch (error) { if (error && error.code !== 'ENOENT') throw error; }
  }
  return { removed, orphans: candidates.length };
}
function scheduleOrphanSweepOnce() {
  if (orphanSweepScheduled) return;
  orphanSweepScheduled = true;
  const timer = setTimeout(() => {
    reconcileCollectionImageOrphans().then(result => {
      if (result && result.removed) console.warn(`[DATA_INTEGRITY] ${result.removed} yetim model görseli dosyası temizlendi. / orphan collection image file(s) removed.`);
    }).catch(error => console.error('[DATA_INTEGRITY] Yetim görsel taraması başarısız. / Orphan image sweep failed:', error && error.message || error));
  }, 30000);
  if (typeof timer.unref === 'function') timer.unref();
}
// SVG bilerek dışarıda bırakılır: içine gömülü <script> barındırabilir ve
// tarayıcı doğrudan /api/collection-images/:id üzerinden image/svg+xml olarak
// açtığında origin içinde çalışabilir (stored XSS). Koleksiyon fotoğrafları
// için SVG'nin herhangi bir gerçek kullanım amacı yok (yükleme her zaman
// accept="image/*" ile kameradan/telefondan gelen raster görsel bekler).
const ALLOWED_COLLECTION_IMAGE_TYPES = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif' };
function imageExtension(mimeType) {
  return ALLOWED_COLLECTION_IMAGE_TYPES[String(mimeType || '').toLowerCase()] || '.img';
}
function publicCollectionImage(item) {
  return { id: item.id, rowId: item.rowId, filename: item.filename, mimeType: item.mimeType, size: item.size, createdAt: item.createdAt, updatedAt: item.updatedAt, url: `/api/collection-images/${encodeURIComponent(item.id)}` };
}
function saveCollectionImage(payload) {
  const { data, item, storedPath } = collectionImagePayload(payload || {});
  atomicWriteBuffer(storedPath, data);
  // Önceki görsel burada silinmez: çoğaltılmış bir Koleksiyon satırı aynı referansı
  // kullanıyor olabilir. Tarayıcı yeni referansı satıra yazdıktan sonra yalnız gerçekten
  // kullanılmayan eski referansı DELETE endpoint'iyle temizler.
  try { mutateCollectionImageIndex(draft => addIndexItem(draft, item)); }
  catch (error) {
    try { fs.unlinkSync(storedPath); } catch (_) {}
    throw error;
  }
  return publicCollectionImage(item);
}
function collectionImagePayload({ rowId, filename, mimeType, base64, buffer }) {
  const rowKey = String(rowId == null ? '' : rowId).trim().slice(0, 160);
  if (!rowKey) throw new Error('Koleksiyon satır kimliği zorunlu.');
  if (!Object.prototype.hasOwnProperty.call(ALLOWED_COLLECTION_IMAGE_TYPES, String(mimeType || '').toLowerCase())) {
    throw new Error('Yalnız JPEG, PNG, WEBP veya GIF görsel dosyaları kabul edilir.');
  }
  const data = Buffer.isBuffer(buffer) ? buffer : Buffer.from(String(base64 || ''), 'base64');
  if (!data.length) throw new Error('Görsel içeriği boş.');
  if (data.length > RAW_COLLECTION_IMAGE_MAX_BYTES) throw new Error('Ham model görseli 50 MB boyut sınırını aşamaz.');
  ensureDir(COLLECTION_IMAGES_ROOT);
  const id = `ci_${Date.now()}_${crypto.randomBytes(6).toString('hex')}`;
  const storedName = id + imageExtension(mimeType);
  const now = new Date().toISOString();
  const item = { id, rowId: rowKey, filename: safeFilename(filename, `collection-${rowKey}${imageExtension(mimeType)}`), mimeType: String(mimeType), size: data.length, storedName, createdAt: now, updatedAt: now, storageMode: 'original' };
  return { data, item, storedPath: path.join(COLLECTION_IMAGES_ROOT, storedName) };
}
/* Toplu yol: dosya asenkron ve dayanıklı yazılır, kayıt belleğe ANCAK
   dosya diskteyken girer, indeks kalıcılaşması ertelenir. Çağıran, görsele
   işaret eden bağlantıyı (imagemap) yazmadan önce flushCollectionImageIndex
   beklemelidir. base64 yerine doğrudan buffer kabul eder (gidiş-dönüş
   kodlama yok). */
async function saveCollectionImageDeferred(payload) {
  const { data, item, storedPath } = collectionImagePayload(payload || {});
  await durableWriterFor(storedPath).createNew(storedPath, data);
  mutateCollectionImageIndex(draft => addIndexItem(draft, item), { defer: true });
  scheduleOrphanSweepOnce();
  return publicCollectionImage(item);
}
// Rota bağlı DEĞİL (bkz. server.js PUT /api/model-images/:id/optimize → 410):
// aynı ref altında bayt değiştirmek immutable görsel önbelleğinde eski kopyayı
// bırakır. Yalnız yerel bakım/kurtarma araçları için tutulur.
function replaceCollectionImage(id, { filename, mimeType, base64 }) {
  const clean = String(id || '').replace(/[^A-Za-z0-9_-]/g, '');
  const type = String(mimeType || '').toLowerCase();
  if (!Object.prototype.hasOwnProperty.call(ALLOWED_COLLECTION_IMAGE_TYPES, type)) throw new Error('Yalnız JPEG, PNG, WEBP veya GIF görsel dosyaları kabul edilir.');
  const data = Buffer.from(String(base64 || ''), 'base64');
  if (!data.length) throw new Error('Görsel içeriği boş.');
  if (data.length > RAW_COLLECTION_IMAGE_MAX_BYTES) throw new Error('Ham model görseli 50 MB boyut sınırını aşamaz.');
  const index = readCollectionImageIndex(), position = index.findIndex(item => item.id === clean);
  if (position < 0) throw new Error('Model görseli bulunamadı.');
  const previous = index[position], storedName = clean + imageExtension(type);
  atomicWriteBuffer(path.join(COLLECTION_IMAGES_ROOT, storedName), data);
  const item = {
    ...previous,
    filename: safeFilename(filename || previous.filename, `model-${clean}${imageExtension(type)}`),
    mimeType: type,
    size: data.length,
    storedName,
    updatedAt: new Date().toISOString(),
    storageMode: 'original',
  };
  index[position] = item;
  writeCollectionImageIndex(index);
  if (previous.storedName && previous.storedName !== storedName) {
    try { fs.unlinkSync(resolveStoredFile(COLLECTION_IMAGES_ROOT, previous.storedName)); } catch (err) { if (err && err.code !== 'ENOENT') throw err; }
  }
  return publicCollectionImage(item);
}
function collectionImageOptimizationStatus(limit = 50) {
  const { maxBytes, maxKb } = getModelImageSettings();
  const pending = readCollectionImageIndex()
    .filter(item => Number(item && item.optimizedVersion) < COLLECTION_IMAGE_OPTIMIZATION_VERSION || Number(item && item.size) > maxBytes)
    .slice(0, Math.max(1, Math.min(200, Number(limit) || 50)))
    .map(publicCollectionImage);
  let completed = false;
  try {
    const marker = JSON.parse(fs.readFileSync(COLLECTION_IMAGES_OPTIMIZATION, 'utf8'));
    completed = marker && marker.version === COLLECTION_IMAGE_OPTIMIZATION_VERSION && Number(marker.maxBytes) === maxBytes && pending.length === 0;
  } catch (_) {}
  return { version: COLLECTION_IMAGE_OPTIMIZATION_VERSION, maxBytes, maxKb, completed, pending };
}
function completeCollectionImageOptimization() {
  const { maxBytes, maxKb } = getModelImageSettings();
  const remaining = readCollectionImageIndex().filter(item => Number(item && item.optimizedVersion) < COLLECTION_IMAGE_OPTIMIZATION_VERSION || Number(item && item.size) > maxBytes).length;
  if (remaining) return { completed: false, remaining };
  atomicWriteJson(COLLECTION_IMAGES_OPTIMIZATION, { version: COLLECTION_IMAGE_OPTIMIZATION_VERSION, maxBytes, completedAt: new Date().toISOString() });
  return { completed: true, remaining: 0, maxBytes, maxKb };
}
function getCollectionImage(id) {
  const clean = String(id || '').replace(/[^A-Za-z0-9_-]/g, '');
  const item = cachedCollectionImageIndex().byId.get(clean);
  if (!item) return null;
  const full = resolveStoredFile(COLLECTION_IMAGES_ROOT, item.storedName);
  if (!fs.existsSync(full)) return null;
  return { item, full };
}
function deleteCollectionImage(id) {
  const clean = String(id || '').replace(/[^A-Za-z0-9_-]/g, '');
  const item = cachedCollectionImageIndex().byId.get(clean);
  if (!item) return false;
  const full = resolveStoredFile(COLLECTION_IMAGES_ROOT, item.storedName);
  try { fs.unlinkSync(full); } catch (err) { if (err.code !== 'ENOENT') throw err; }
  mutateCollectionImageIndex(draft => removeIndexItem(draft, clean));
  return true;
}
// Toplu yolun silme karşılığı (geri alma, eski dosyayı düşürme): indeks
// kalıcılaşması ertelenir; dosya kaydı bellekten düştükten sonra silinir.
async function deleteCollectionImageDeferred(id) {
  const clean = String(id || '').replace(/[^A-Za-z0-9_-]/g, '');
  const item = cachedCollectionImageIndex().byId.get(clean);
  if (!item) return false;
  const full = resolveStoredFile(COLLECTION_IMAGES_ROOT, item.storedName);
  mutateCollectionImageIndex(draft => removeIndexItem(draft, clean), { defer: true });
  try { await fsp.unlink(full); } catch (err) { if (err.code !== 'ENOENT') throw err; }
  return true;
}
/* v10.90 — GERÇEK DEPO SIFIRLAMASI.
   Eski sürüm yalnız index.json'da adı geçen dosyaları siliyordu. Depoda
   index'e hiç yazılamamış (yazma yarıda kalmış) veya index bir kez bozulup
   yeniden oluşturulduğu için artık kimsenin bilmediği yetim dosyalar
   kalabiliyordu; bunlar "Buyer Log hiç görsel tutmuyor" sözleşmesini bozar.
   Ayrıca optimizasyon işareti silinen depoya ait bir durum kaydıdır ve
   sıfırlamadan sonra geçerliliğini yitirir. maxKb ayarı BAŞKA bir dosyada
   (model-image-settings.json) tutulur ve bilerek korunur. */
const COLLECTION_IMAGE_STORE_KEEP = new Set([
  path.basename(COLLECTION_IMAGES_INDEX),
  path.basename(COLLECTION_IMAGES_INDEX) + '.bak',
  path.basename(COLLECTION_IMAGES_OPTIMIZATION),
  path.basename(COLLECTION_IMAGES_OPTIMIZATION) + '.bak',
]);
function listStoredCollectionImageFiles() {
  ensureDir(COLLECTION_IMAGES_ROOT);
  let entries = [];
  try { entries = fs.readdirSync(COLLECTION_IMAGES_ROOT, { withFileTypes: true }); } catch (err) { if (err.code !== 'ENOENT') throw err; }
  return entries
    .filter(entry => entry.isFile() && !COLLECTION_IMAGE_STORE_KEEP.has(entry.name) && !entry.name.endsWith('.tmp'))
    .map(entry => entry.name);
}
function deleteAllCollectionImages() {
  // Uçuştaki asenkron indeks yazması bitmeden sıfırlama .bak'ı eski içerikle
  // yeniden oluşturabilirdi; çağıran önce flushCollectionImageIndex bekler.
  if (indexFlushPromise) throw Object.assign(new Error('Model görseli indeksi yazılıyor; birkaç saniye sonra yeniden deneyin. / The model image index is being written; try again in a few seconds.'), { code: 'MODEL_IMAGE_INDEX_BUSY', statusCode: 409 });
  const index = readCollectionImageIndex();
  const known = new Set();
  let deleted = 0;
  for (const item of index) {
    const storedName = String(item && item.storedName || '');
    if (storedName) known.add(storedName);
    const full = resolveStoredFile(COLLECTION_IMAGES_ROOT, storedName);
    try { fs.unlinkSync(full); deleted += 1; } catch (err) { if (err.code !== 'ENOENT') throw err; }
  }
  // Index'te adı geçmeyen yetim görsel dosyaları da gider: aksi hâlde depo
  // "temiz" sayılır ama diskte eski baytlar durur.
  let orphansRemoved = 0;
  for (const name of listStoredCollectionImageFiles()) {
    if (known.has(name)) continue;
    try { fs.unlinkSync(resolveStoredFile(COLLECTION_IMAGES_ROOT, name)); orphansRemoved += 1; }
    catch (err) { if (err.code !== 'ENOENT') throw err; }
  }
  writeCollectionImageIndex([]);
  for (const file of [COLLECTION_IMAGES_INDEX + '.bak', COLLECTION_IMAGES_OPTIMIZATION, COLLECTION_IMAGES_OPTIMIZATION + '.bak']) {
    try { fs.unlinkSync(file); } catch (err) { if (err.code !== 'ENOENT') throw err; }
  }
  return { deleted, requested: index.length, orphansRemoved, remainingFiles: listStoredCollectionImageFiles().length, remainingIndexed: readCollectionImageIndex().length };
}

module.exports = {
  PROJECT_ROOT, SERVER_DATA_ROOT, APP_DATA_ROOT, LOCAL_DATA_ROOT, LOCAL_DB_FILE, MODEL_FILES_ROOT, COLLECTION_IMAGES_ROOT, QTX_FILES_ROOT, LOGS_ROOT, TEMP_ROOT, EMAIL_DRAFT_ROOT, CONFIG_PATH,
  getUserDataInventory, exportBackup, restoreBackup, parseBackup, exportBackupToFile, restoreBackupFromFile,
  saveCollectionImage, replaceCollectionImage, collectionImageOptimizationStatus, completeCollectionImageOptimization,
  getModelImageSettings, saveModelImageSettings,
  getCollectionImage, deleteCollectionImage, deleteAllCollectionImages, readCollectionImageIndex, listStoredCollectionImageFiles, purgeExpiredModelFiles,
  saveCollectionImageDeferred, deleteCollectionImageDeferred, flushCollectionImageIndex, reconcileCollectionImageOrphans, collectionImageIndexStats,
  atomicWriteBuffer, atomicWriteJson, atomicWriteBufferAsync, atomicWriteJsonAsync, resolveStoredFile,
  durableFileRecovery, startupWriteRecovery,
};

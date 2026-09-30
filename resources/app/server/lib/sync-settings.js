'use strict';

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const zlib = require('zlib');
const { promisify } = require('util');
const gzipAsync = promisify(zlib.gzip);
const gunzipAsync = promisify(zlib.gunzip);
const { withFileLeaseAsync, replaceFileWithRetry } = require('./shared-file-transaction');
const { isNetworkPath } = require('./local-path-policy');
const { installationFingerprint: defaultInstallationFingerprint } = require('./installation-fingerprint');
const {
  SYNC_PACKAGE_VERSION, SYNC_PACKAGE_MAX_EVENTS, SYNC_PACKAGE_MAX_BYTES, SYNC_PACKAGE_DIR,
  buildSyncPackages, validateSyncPackage, bundleFileName, gzipBundleFileName, sequenceFromBundleFile, isBundleFile, SYNC_GZIP_SUFFIX,
} = require('./sync-package');

function encode(value) { return encodeURIComponent(String(value || '')); }
function decode(value) { try { return decodeURIComponent(value); } catch (_) { return value; } }
function checksum(value) { return crypto.createHash('sha256').update(JSON.stringify({ ...value, sha256: undefined }), 'utf8').digest('hex'); }
const NETWORK_HEAD_FILE = '_head.json';
const READY_PACKAGE_SUFFIX = '.ready';
const LEGACY_LOCAL_KEYS = ['localDbFolder', 'dbFolderPath', 'databaseFolder', 'dataFolder', 'databasePath'];
const LEGACY_SHARED_KEYS = ['sharedSyncFolder', 'syncFolder', 'sharedFolder'];
/* Hub bir ARŞİV değil, taşıma bandıdır: paket karşı cihaza uygulandıktan sonra
   işlevi biter. Hiçbir budama olmadığı için klasör süresiz büyüyordu (ölçüm:
   465 paket / 222 MB). Saklama penceresi kullanıcı ayarıdır — bu süreden uzun
   çevrimdışı kalan bir cihaz zaten yeniden tohumlanmak zorundadır.
   0 = hiç silme. */
const PACKAGE_RETENTION_CHOICES = [0, 7, 14, 30, 60, 90, 180, 365];
const DEFAULT_PACKAGE_RETENTION_DAYS = 30;
function normalizeRetentionDays(value) {
  // Boş değer 0'a (= süresiz) DÜŞMEMELİ: Number(null) ve Number('') sıfırdır,
  // yani ayarı hiç taşımayan her yol budamayı sessizce kapatırdı.
  if (value == null || value === '') return DEFAULT_PACKAGE_RETENTION_DAYS;
  const days = Math.trunc(Number(value));
  return PACKAGE_RETENTION_CHOICES.includes(days) ? days : DEFAULT_PACKAGE_RETENTION_DAYS;
}

function resolveLocalDbPath(value, fallback, strict = false) {
  const raw = String(value || '').trim();
  if (!raw) return path.resolve(fallback);
  if (isNetworkPath(raw)) {
    if (strict) throw new Error('Local DB yalnızca yerel diskte tutulabilir.');
    return path.resolve(fallback);
  }
  const resolved = path.resolve(raw);
  if (isNetworkPath(resolved)) {
    if (strict) throw new Error('Local DB yalnızca yerel diskte tutulabilir.');
    return path.resolve(fallback);
  }
  // The application owns the filename. A selected .db path means its
  // containing local folder; the active file remains BuyerLogLocal.db.
  const folder = path.extname(resolved).toLowerCase() === '.db' ? path.dirname(resolved) : resolved;
  return path.join(folder, path.basename(fallback));
}

function resolveSharedSyncRoot(value, strict = false) {
  const raw = String(value == null ? '' : value).trim();
  if (!raw) {
    if (strict) throw new Error('Sync klasörü bulunamadı.');
    return '';
  }
  // path.resolve preserves Windows UNC roots on the Windows runtime while
  // still normalizing picker output that uses forward slashes.
  return path.resolve(raw);
}

function withTimeout(operation, timeoutMs, label) {
  let timer = null;
  return Promise.race([
    Promise.resolve().then(operation),
    new Promise((_, reject) => { timer = setTimeout(() => { const error = new Error(`${label}: Network Unavailable`); error.code = 'SYNC_NETWORK_TIMEOUT'; reject(error); }, timeoutMs); timer.unref?.(); }),
  ]).finally(() => clearTimeout(timer));
}

async function writeValidatedJson(file, value, onMetrics = null) {
  const totalStartedAt = Date.now();
  const tmp = `${file}.${process.pid}.${Date.now()}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  await fsp.mkdir(path.dirname(file), { recursive: true });
  const serialized = JSON.stringify(value, null, 2);
  let writeMs = 0, verificationMs = 0, renameMs = 0;
  try {
    const writeStartedAt = Date.now();
    const handle = await fsp.open(tmp, 'w');
    try { await handle.writeFile(serialized, 'utf8'); try { await handle.sync(); } catch (_) {} } finally { await handle.close(); }
    writeMs = Date.now() - writeStartedAt;
    const verificationStartedAt = Date.now();
    const verified = JSON.parse(await fsp.readFile(tmp, 'utf8'));
    if (JSON.stringify(verified) !== JSON.stringify(value)) throw new Error('Sync paketi doğrulanamadı.');
    verificationMs = Date.now() - verificationStartedAt;
    // Ortak ağ üzerinde rename geçici olarak EPERM/EBUSY verebilir; sınırlı retry
    // ile geç, kalıcı hatada temp dosyasını ağ klasöründe bırakma.
    const renameStartedAt = Date.now();
    await replaceFileWithRetry(tmp, file);
    renameMs = Date.now() - renameStartedAt;
    const bytes = Buffer.byteLength(serialized, 'utf8');
    try { if (typeof onMetrics === 'function') onMetrics({ bytes, writeMs, verificationMs, renameMs, totalMs: Date.now() - totalStartedAt }); } catch (_) {}
    return bytes;
  } finally { try { await fsp.unlink(tmp); } catch (_) {} }
}
async function readJson(file) { return JSON.parse(await fsp.readFile(file, 'utf8')); }
async function writeValidatedGzipJson(file, value, onMetrics = null) {
  const totalStartedAt = Date.now();
  const tmp = `${file}.${process.pid}.${Date.now()}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  await fsp.mkdir(path.dirname(file), { recursive: true });
  const serialized = Buffer.from(JSON.stringify(value), 'utf8');
  const compressed = await gzipAsync(serialized, { level: zlib.constants.Z_BEST_SPEED });
  let writeMs = 0, verificationMs = 0, renameMs = 0;
  try {
    const writeStartedAt = Date.now();
    const handle = await fsp.open(tmp, 'w');
    try { await handle.writeFile(compressed); try { await handle.sync(); } catch (_) {} } finally { await handle.close(); }
    writeMs = Date.now() - writeStartedAt;
    const verificationStartedAt = Date.now();
    const verifiedBuffer = await gunzipAsync(await fsp.readFile(tmp));
    const verified = JSON.parse(verifiedBuffer.toString('utf8'));
    if (JSON.stringify(verified) !== JSON.stringify(value)) throw new Error('Compressed sync package could not be verified.');
    verificationMs = Date.now() - verificationStartedAt;
    const renameStartedAt = Date.now();
    await replaceFileWithRetry(tmp, file);
    renameMs = Date.now() - renameStartedAt;
    try { if (typeof onMetrics === 'function') onMetrics({ bytes: compressed.length, uncompressedBytes: serialized.length, writeMs, verificationMs, renameMs, totalMs: Date.now() - totalStartedAt }); } catch (_) {}
    return compressed.length;
  } finally { try { await fsp.unlink(tmp); } catch (_) {} }
}
async function readSyncJson(file) {
  if (String(file || '').endsWith(SYNC_GZIP_SUFFIX)) {
    const compressed = await fsp.readFile(file);
    const raw = await gunzipAsync(compressed);
    return { payload: JSON.parse(raw.toString('utf8')), bytes: compressed.length, compressed: true };
  }
  const raw = await fsp.readFile(file, 'utf8');
  return { payload: JSON.parse(raw), bytes: Buffer.byteLength(raw, 'utf8'), compressed: false };
}

function createSyncSettings({ localDataRoot, localDb, trace = null, onStateChange = null, networkTimeoutMs = 15000, filterIncomingDeltas = null, filterOutgoingDeltas = null, installationFingerprint = defaultInstallationFingerprint }) {
  const file = path.join(localDataRoot, 'sync-settings.json');
  const resolveInstallation = () => { try { return String((typeof installationFingerprint === 'function' ? installationFingerprint() : installationFingerprint) || '').trim(); } catch (_) { return ''; } };
  let syncInFlight = null;
  let paused = false;
  let pauseReason = '';
  let runtimeState = null;
  let lastStateNoticeAt = 0;
  const stateListeners = new Set(typeof onStateChange === 'function' ? [onStateChange] : []);
  const emit = (name, detail = null) => { try { if (typeof trace === 'function') trace(name, detail); } catch (_) {} };
  const net = (operation, label) => withTimeout(operation, Math.max(500, Number(networkTimeoutMs) || 4000), label);
  /* Varsayılanlar çağrı anında üretilir. Sabit bir nesne olarak tutulduğunda
     localDb.getDeviceId() createSyncSettings çağrısında — yani sunucu modülü
     yüklenirken — çalışıyor ve cihaz kimliğini okumak için diske iniyordu.
     Fonksiyona çevirmek bu okumayı açılış kritik yolundan çıkarır; ayrıca
     localDb.setFolder ile konum değişirse varsayılan klasör de güncel kalır. */
  function makeDefaults() {
    return {
      sharedSyncRoot: '', syncPeriodMinutes: 5, localDbPath: path.resolve(localDb.getFile ? localDb.getFile() : localDb.file),
      deviceId: localDb.getDeviceId ? localDb.getDeviceId() : '', lastSync: null, lastAttempt: null, nextSync: null,
      pendingUpload: 0, pendingAck: 0, pendingDownload: 0, localCreate: 0, localUpdate: 0, localDelete: 0, conflict: 0,
      corruptPackages: 0, uploadFailures: 0, retries: 0, progress: null, lastError: null, online: false, checkpoint: {},
      downloadedEvents: 0, uploadedEvents: 0, downloadedPackages: 0, uploadedPackages: 0, lastDurationMs: 0, networkBytesRead: 0, networkBytesWritten: 0,
      localSnapshotDate: null, scannedPackages: 0, skippedDeviceFolders: 0, legacyScanComplete: false,
      packageRetentionDays: DEFAULT_PACKAGE_RETENTION_DAYS, prunedPackages: 0, lastPruneAt: null, legacyCompatibilityMode: false, legacyPeerDevices: [], gzipBundleMode: false, gzipUnsupportedPeerDevices: [], protocolVersion: 2, checkpointAckSupport: true,
    };
  }
  function canonicalize(value) {
    const defaults = makeDefaults(), raw = value && typeof value === 'object' ? value : {};
    const localValue = raw.localDbPath || LEGACY_LOCAL_KEYS.map(key => raw[key]).find(Boolean);
    const sharedValue = raw.sharedSyncRoot != null ? raw.sharedSyncRoot : LEGACY_SHARED_KEYS.map(key => raw[key]).find(value => value != null);
    const next = { ...defaults, ...raw,
      localDbPath: resolveLocalDbPath(localValue, defaults.localDbPath),
      sharedSyncRoot: resolveSharedSyncRoot(sharedValue),
      deviceId: defaults.deviceId,
      packageRetentionDays: normalizeRetentionDays(raw.packageRetentionDays == null ? defaults.packageRetentionDays : raw.packageRetentionDays),
    };
    [...LEGACY_LOCAL_KEYS, ...LEGACY_SHARED_KEYS].forEach(key => delete next[key]);
    return next;
  }
  function exposed(value) {
    const next = canonicalize(value);
    return { ...next, localDbFolder: path.dirname(next.localDbPath), sharedSyncFolder: next.sharedSyncRoot };
  }
  async function read() {
    const defaults = makeDefaults();
    try {
      const stored = JSON.parse(await fsp.readFile(file, 'utf8')) || {};
      const value = canonicalize(stored), legacyPresent = [...LEGACY_LOCAL_KEYS, ...LEGACY_SHARED_KEYS].some(key => Object.hasOwn(stored, key));
      if (legacyPresent || stored.localDbPath !== value.localDbPath || stored.sharedSyncRoot !== value.sharedSyncRoot) {
        try { await write(value); } catch (error) { emit('SYNC_SETTINGS_MIGRATION_FAILED', { error: error && error.message || String(error) }); }
      }
      const visible = runtimeState ? { ...value, ...runtimeState } : value;
      return exposed(visible);
    }
    catch (_) { return exposed(defaults); }
  }
  async function write(value) {
    const canonical = canonicalize(value);
    return withFileLeaseAsync(file, async () => {
      await fsp.mkdir(path.dirname(file), { recursive: true });
      const tmp = `${file}.${process.pid}.${Date.now()}.${crypto.randomBytes(4).toString('hex')}.tmp`;
      try {
        const handle = await fsp.open(tmp, 'wx');
        try {
          await handle.writeFile(JSON.stringify(canonical, null, 2), 'utf8');
          try { await handle.sync(); } catch (_) { /* best effort on local filesystem filters */ }
        } finally { await handle.close(); }
        await replaceFileWithRetry(tmp, file);
        return canonical;
      } finally { try { await fsp.unlink(tmp); } catch (_) {} }
    });
  }
  async function save(folder, localDbPath = null) {
    const current = await read();
    current.sharedSyncRoot = resolveSharedSyncRoot(folder);
    if (localDbPath != null) current.localDbPath = resolveLocalDbPath(localDbPath, current.localDbPath, true);
    current.lastError = null;
    return exposed(await write(current));
  }
  async function savePeriod(value) {
    const current = await read();
    const raw = String(value || '').toLowerCase() === 'manual' ? 'manual' : Number(value);
    current.syncPeriodMinutes = raw === 'manual' || [1, 2, 5, 10, 15].includes(raw) ? raw : 5;
    return exposed(await write(current));
  }
  async function saveRetentionDays(value) {
    const current = await read();
    current.packageRetentionDays = normalizeRetentionDays(value);
    return exposed(await write(current));
  }
  function pause(reason = '') { paused = true; pauseReason = String(reason || ''); emit('SYNC_PAUSED', { reason: pauseReason }); }
  function resume() { paused = false; pauseReason = ''; emit('SYNC_RESUMED'); }
  function isPaused() { return paused; }
  async function waitForIdle(timeoutMs = 30000) {
    const deadline = Date.now() + Math.max(1000, Number(timeoutMs) || 30000);
    while (syncInFlight && Date.now() < deadline) await Promise.race([syncInFlight.catch(() => {}), new Promise(resolve => setTimeout(resolve, 25))]);
    if (syncInFlight) throw Object.assign(new Error('Sync işlemi restore öncesinde tamamlanamadı.'), { code: 'SYNC_BUSY', statusCode: 409 });
  }
  async function restoreMetadata(snapshot) {
    const current = await read(), previousSharedSyncRoot = String(current.sharedSyncRoot || '');
    const requested = String(snapshot && (snapshot.sharedSyncRoot || snapshot.sharedSyncFolder) || '').trim();
    const sharedSyncRoot = requested && isNetworkPath(requested) ? resolveSharedSyncRoot(requested) : '';
    const next = { ...current, sharedSyncRoot, syncPeriodMinutes: snapshot && snapshot.syncPeriodMinutes || current.syncPeriodMinutes, packageRetentionDays: normalizeRetentionDays(snapshot && snapshot.packageRetentionDays) };
    const settings = exposed(await write(next));
    return { settings, requiresSharedSyncSetup: Boolean(requested && !sharedSyncRoot), previousSharedSyncRoot: requested || previousSharedSyncRoot };
  }
  async function testConnection(folder) {
    const root = resolveSharedSyncRoot(folder, true);
    const stat = await net(() => fsp.stat(root), 'Sync klasörü kontrolü');
    if (!stat.isDirectory()) throw new Error('Sync klasörü bulunamadı.');
    await net(() => fsp.access(root, fs.constants.R_OK | fs.constants.W_OK), 'Sync klasörü erişimi');
    const probe = path.join(root, `.buyerlog-sync-test-${process.pid}-${Date.now()}`), renamed = `${probe}.renamed`;
    try {
      await net(() => fsp.writeFile(probe, 'ok', 'utf8'), 'Sync yazma testi');
      await net(() => fsp.rename(probe, renamed), 'Sync rename testi');
      await net(() => fsp.unlink(renamed), 'Sync temizlik testi');
    } catch (error) {
      void fsp.unlink(probe).catch(() => {}); void fsp.unlink(renamed).catch(() => {}); throw error;
    }
    return { folder: root, ok: true };
  }
  async function checkSyncRoot(folder) {
    const root = resolveSharedSyncRoot(folder, true);
    const stat = await net(() => fsp.stat(root), 'Sync klasörü kontrolü');
    if (!stat.isDirectory()) throw new Error('Sync klasörü bulunamadı.');
    await net(() => fsp.access(root, fs.constants.R_OK | fs.constants.W_OK), 'Sync klasörü yazma erişimi');
    return root;
  }
  async function acknowledgeLocalUploads(ackRoot, deviceId) {
    const deviceRoot = path.join(ackRoot, encode(deviceId));
    let entries = [];
    try { entries = await net(() => fsp.readdir(deviceRoot, { withFileTypes: true }), 'ACK klasörü okuma'); } catch (_) { return 0; }
    let checkpointAckSequence = 0;
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
      try {
        const ack = await net(() => readJson(path.join(deviceRoot, entry.name)), 'Checkpoint ACK okuma');
        checkpointAckSequence = Math.max(checkpointAckSequence, Number(ack && ack.lastContiguousSequence) || 0);
      } catch (_) {}
    }
    const ids = [];
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name === 'packages') continue;
      try { if ((await net(() => fsp.readdir(path.join(deviceRoot, entry.name)), 'ACK okuma')).some(name => name.endsWith('.json'))) ids.push(decode(entry.name)); } catch (_) {}
    }
    let marked = ids.length ? (await localDb.markAcknowledged(ids)).marked : 0;
    const packageRoot = path.join(deviceRoot, 'packages');
    let packageEntries = [];
    try { packageEntries = await net(() => fsp.readdir(packageRoot, { withFileTypes: true }), 'Package ACK klasörü okuma'); } catch (_) {}
    let maxAckSequence = 0;
    for (const entry of packageEntries) {
      if (!entry.isDirectory()) continue;
      let names = [];
      try { names = await net(() => fsp.readdir(path.join(packageRoot, entry.name)), 'Package ACK okuma'); } catch (_) { continue; }
      for (const name of names.filter(name => name.endsWith('.json'))) {
        try {
          const ack = await net(() => readJson(path.join(packageRoot, entry.name, name)), 'Package ACK detayı okuma');
          maxAckSequence = Math.max(maxAckSequence, Number(ack && ack.lastSeq) || 0);
        } catch (_) {}
      }
    }
    const contiguousAck = Math.max(maxAckSequence, checkpointAckSequence);
    if (contiguousAck && typeof localDb.markAcknowledgedThrough === 'function') marked += (await localDb.markAcknowledgedThrough(contiguousAck)).marked;
    return marked;
  }

  async function detectLegacyPeers(changesRoot, deviceId, retentionDays) {
    let entries = [];
    try { entries = await net(() => fsp.readdir(changesRoot, { withFileTypes: true }), 'Sync peer listesi okuma'); }
    catch (error) { if (error.code === 'ENOENT') return []; throw error; }
    const days = normalizeRetentionDays(retentionDays), cutoff = days ? Date.now() - days * 86400000 : 0;
    const legacy = [];
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name === encode(deviceId)) continue;
      const sourceRoot = path.join(changesRoot, entry.name), sourceId = decode(entry.name);
      let head = null;
      try { head = await net(() => readJson(path.join(sourceRoot, NETWORK_HEAD_FILE)), 'Peer capability okuma'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
      if (head && (head.supportsBundleV2 === true || Number(head.packageFormatVersion) >= 2)) continue;
      if (cutoff) {
        try {
          const stat = await net(() => fsp.stat(head ? path.join(sourceRoot, NETWORK_HEAD_FILE) : sourceRoot), 'Peer yaş kontrolü');
          if (stat.mtimeMs < cutoff) continue;
        } catch (_) {}
      }
      legacy.push(sourceId);
    }
    return legacy;
  }

  async function detectGzipUnsupportedPeers(changesRoot, deviceId, retentionDays) {
    let entries = [];
    try { entries = await net(() => fsp.readdir(changesRoot, { withFileTypes: true }), 'Sync peer capability listesi okuma'); }
    catch (error) { if (error.code === 'ENOENT') return []; throw error; }
    const days = normalizeRetentionDays(retentionDays), cutoff = days ? Date.now() - days * 86400000 : 0;
    const unsupported = [];
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name === encode(deviceId)) continue;
      const sourceRoot = path.join(changesRoot, entry.name), sourceId = decode(entry.name);
      let head = null;
      try { head = await net(() => readJson(path.join(sourceRoot, NETWORK_HEAD_FILE)), 'Peer gzip capability okuma'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
      if (!head || !(head.supportsBundleV2 === true || Number(head.packageFormatVersion) >= 2)) continue;
      if (cutoff) {
        try { const stat = await net(() => fsp.stat(path.join(sourceRoot, NETWORK_HEAD_FILE)), 'Peer gzip yaş kontrolü'); if (stat.mtimeMs < cutoff) continue; } catch (_) {}
      }
      if (head.supportsGzipBundles !== true) unsupported.push(sourceId);
    }
    return unsupported;
  }

  async function writeHead(deviceRoot, deviceId, latestSequence, packageFormatVersion) {
    return net(() => writeValidatedJson(path.join(deviceRoot, NETWORK_HEAD_FILE), {
      deviceId, latestSequence: Number(latestSequence) || 0, updatedAt: new Date().toISOString(), installation: resolveInstallation() || undefined,
      supportsBundleV2: true, supportsGzipBundles: true, checkpointAckSupport: true, protocolVersion: 2, packageFormatVersion: Number(packageFormatVersion) || SYNC_PACKAGE_VERSION,
    }), 'Checkpoint head yazma');
  }

  async function ensureCapabilityHead(deviceRoot, deviceId) {
    let head = null;
    try { head = await net(() => readJson(path.join(deviceRoot, NETWORK_HEAD_FILE)), 'Capability head okuma'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    const installation = resolveInstallation();
    if (head && head.supportsBundleV2 === true && head.supportsGzipBundles === true && head.checkpointAckSupport === true && (!installation || head.installation === installation)) return 0;
    return writeHead(deviceRoot, deviceId, Number(head && head.latestSequence) || 0, Number(head && head.packageFormatVersion) || 1);
  }

  /* This device only prunes its own transport files. v1 event files and v2
     bundle packages can coexist during rollout; both obey the same retention. */
  async function prunePackages(deviceRoot, ackRoot, deviceId, retentionDays) {
    const days = normalizeRetentionDays(retentionDays);
    if (!days) return 0;
    const cutoff = Date.now() - days * 86400000;
    let pruned = 0;
    async function pruneFolder(folder, kind) {
      let names = [];
      try { names = await net(() => fsp.readdir(folder), 'Budama listesi okuma'); }
      catch (_) { return; }
      for (const name of names) {
        if (name === NETWORK_HEAD_FILE) continue;
        if (!name.endsWith(READY_PACKAGE_SUFFIX) && !name.endsWith('.json') && !name.endsWith(SYNC_GZIP_SUFFIX)) continue;
        const target = path.join(folder, name);
        try {
          const stat = await net(() => fsp.stat(target), 'Budama yaş kontrolü');
          if (stat.mtimeMs >= cutoff) continue;
          await net(() => fsp.unlink(target), 'Eski paket silme');
          pruned++;
          if (kind === 'v2') {
            const packageId = String(name).replace(READY_PACKAGE_SUFFIX, '').replace(SYNC_GZIP_SUFFIX, '').split('-').slice(2).join('-');
            if (packageId) {
              try { await net(() => fsp.rm(path.join(ackRoot, encode(deviceId), 'packages', packageId), { recursive: true, force: true }), 'Eski package ACK silme'); } catch (_) {}
            }
          } else {
            const dash = String(name).indexOf('-');
            const eventId = dash >= 0 ? name.slice(dash + 1).replace(READY_PACKAGE_SUFFIX, '').replace(/[.]json$/, '') : '';
            if (eventId) {
              try { await net(() => fsp.rm(path.join(ackRoot, encode(deviceId), eventId), { recursive: true, force: true }), 'Eski ACK silme'); } catch (_) {}
            }
          }
        } catch (_) { /* kilitli veya erişilemeyen paket bir sonraki turda denenir */ }
      }
    }
    await pruneFolder(deviceRoot, 'v1');
    await pruneFolder(path.join(deviceRoot, SYNC_PACKAGE_DIR), 'v2');
    if (pruned) emit('SYNC_PACKAGES_PRUNED', { deviceId, pruned, retentionDays: days });
    return pruned;
  }
  function notifyState(value, force = false) {
    const visible = exposed(value);
    runtimeState = visible;
    const now = Date.now();
    if (!force && now - lastStateNoticeAt < 100) return;
    lastStateNoticeAt = now;
    for (const listener of stateListeners) {
      try { listener(visible); } catch (_) {}
    }
  }
  function clearRuntimeState() { runtimeState = null; }
  function subscribeStateChange(listener) {
    if (typeof listener !== 'function') return () => {};
    stateListeners.add(listener);
    return () => stateListeners.delete(listener);
  }
  async function runSyncOnce() {
    const startedAt = Date.now();
    const current = await read();
    let networkBytesWritten = 0, networkBytesRead = 0, uploadedEvents = 0, uploadedPackages = 0, downloadedEvents = 0, downloadedPackages = 0;
    try {
      current.lastAttempt = new Date().toISOString(); await write(current);
      const root = current.sharedSyncRoot;
      if (!root) {
        const result = await write({ ...current, online: false, pendingUpload: (await localDb.pendingCount()), lastError: 'Sync klasörü ayarlanmadı.', progress: null, lastDurationMs: Date.now() - startedAt });
        notifyState(result, true); clearRuntimeState();
        emit('SYNC_COMPLETE', { online: false, reason: 'not-configured', durationMs: result.lastDurationMs });
        return result;
      }
      emit('NETWORK_FIRST_ACCESS', { root });
      await checkSyncRoot(root);
      const syncRoot = path.join(root, 'BUYER_LOG_SYNC'), changesRoot = path.join(syncRoot, 'changes'), ackRoot = path.join(syncRoot, 'acks');
      /* Kopyalanmış kurulum koruması (7.0.178). Veri klasörü başka bir
         bilgisayara/kullanıcıya kopyalandıysa iki kurulum aynı deviceId ile
         aynı cihaz klasörüne yazar ve birbirinin değişikliğini hiç okumaz.
         (1) DB'deki kurulum mührü başka kuruluma aitse, (2) mühürsüz eski
         kopyalarda ise bu cihaz klasörünün head'ini başka bir kurulum
         sahiplenmişse kimlik yenilenir; yerel olaylar yeni kimlikle yeniden
         yayımlanır ve eski ortak klasör yabancı cihaz olarak okunur. */
      const installation = resolveInstallation();
      if (installation && typeof localDb.ensureDeviceBinding === 'function') {
        const binding = await localDb.ensureDeviceBinding(installation);
        if (binding && binding.status === 'rotated') emit('SYNC_DEVICE_ID_ROTATED', { reason: binding.reason, previousDeviceId: binding.previousDeviceId, deviceId: binding.deviceId, reissued: binding.reissued });
      }
      let deviceId = localDb.getDeviceId ? localDb.getDeviceId() : current.deviceId, deviceRoot = path.join(changesRoot, encode(deviceId));
      if (installation && typeof localDb.rotateDeviceId === 'function') {
        let ownHead = null;
        try { ownHead = await net(() => readJson(path.join(deviceRoot, NETWORK_HEAD_FILE)), 'Cihaz klasörü sahipliği okuma'); }
        catch (error) { if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error; }
        if (ownHead && ownHead.installation && ownHead.installation !== installation) {
          const rotated = await localDb.rotateDeviceId({ reason: 'shared-hub-device-collision', fingerprint: installation });
          emit('SYNC_DEVICE_ID_ROTATED', { reason: rotated.reason, previousDeviceId: rotated.previousDeviceId, deviceId: rotated.deviceId, reissued: rotated.reissued });
          deviceId = rotated.deviceId; deviceRoot = path.join(changesRoot, encode(deviceId));
        }
      }
      await net(() => fsp.mkdir(deviceRoot, { recursive: true }), 'Cihaz klasörü oluşturma');

      const pendingAll = await localDb.pending(10000);
      const pending = typeof filterOutgoingDeltas === 'function' ? filterOutgoingDeltas(pendingAll) : pendingAll;
      const retained = new Set(pending.map(item => item && item.eventId).filter(Boolean));
      const discarded = pendingAll.filter(item => item && item.eventId && !retained.has(item.eventId));
      // Eski genel taşıma yolundan çıkarılan belgeler tekrar pakete girmesin.
      // İş verisi, ilgili modülün sahip-bazlı replikasyon yolunda korunur;
      // burada yalnız genel paketten emniyetle düşürülür.
      if (discarded.length) await localDb.markSynced(discarded.map(item => item.eventId));
      const pendingTotal = pending.length;
      const localCreate = pending.filter(item => item.operation === 'create' || item.patch?._created).length;
      const localDelete = pending.filter(item => item.delete || item.operation === 'delete').length;
      const localUpdate = Math.max(0, pending.length - localCreate - localDelete);
      const uploadBytesTotal = pending.reduce((total, item) => total + Buffer.byteLength(JSON.stringify(item), 'utf8'), 0);

      /* Safe rollout: a recently active peer that has never advertised v2
         support keeps this device on the legacy writer. New readers always read
         both formats; once every active peer advertises v2, writes bundle only. */
      const legacyPeerDevices = await detectLegacyPeers(changesRoot, deviceId, current.packageRetentionDays);
      const legacyCompatibilityMode = legacyPeerDevices.length > 0;
      const gzipUnsupportedPeerDevices = legacyCompatibilityMode ? [] : await detectGzipUnsupportedPeers(changesRoot, deviceId, current.packageRetentionDays);
      const gzipBundleMode = !legacyCompatibilityMode && gzipUnsupportedPeerDevices.length === 0;
      const packageBuildStartedAt = Date.now();
      const packageBuild = legacyCompatibilityMode ? null : buildSyncPackages(pending, { deviceId });
      const packageTotal = legacyCompatibilityMode ? pending.length : packageBuild.packages.length;
      emit('SYNC_PACKAGE_PREPARED', { pendingEvents: pending.length, totalPending: pendingTotal, transportEvents: legacyCompatibilityMode ? pending.length : packageBuild.transportEvents, packages: packageTotal, legacyCompatibilityMode, gzipBundleMode, durationMs: Date.now() - packageBuildStartedAt });

      current.progress = {
        phase: 'upload', stage: legacyCompatibilityMode ? 'Legacy peer compatibility' : 'Paket hazırlanıyor',
        uploadDone: 0, uploadTotal: pending.length, totalPending: pendingTotal, totalRemaining: pendingTotal,
        packageDone: 0, packageTotal, bytesDone: 0, bytesTotal: uploadBytesTotal,
        speedBytesPerSecond: 0, etaSeconds: null,
      };
      await write({ ...current, deviceId, localCreate, localUpdate, localDelete, legacyCompatibilityMode, legacyPeerDevices, gzipBundleMode, gzipUnsupportedPeerDevices });
      notifyState({ ...current, deviceId, localCreate, localUpdate, localDelete, legacyCompatibilityMode, legacyPeerDevices, gzipBundleMode, gzipUnsupportedPeerDevices }, true);

      let uploadFailures = 0, uploadHalted = false;
      if (!pending.length) networkBytesWritten += await ensureCapabilityHead(deviceRoot, deviceId);

      if (legacyCompatibilityMode) {
        let done = 0;
        for (const item of pending) {
          const sequence = String(Number(item.localSequence) || 0).padStart(12, '0');
          const target = path.join(deviceRoot, `${sequence}-${encode(item.eventId)}${READY_PACKAGE_SUFFIX}`);
          try {
            let exists = false;
            try { await net(() => fsp.access(target), 'Legacy paket varlık kontrolü'); exists = true; } catch (error) { if (error.code !== 'ENOENT') throw error; }
            if (!exists) networkBytesWritten += await net(() => writeValidatedJson(target, item), 'Legacy paket yükleme');
            networkBytesWritten += await writeHead(deviceRoot, deviceId, Number(item.localSequence) || 0, 1);
            await localDb.markSynced([item.eventId]);
            uploadedEvents++; uploadedPackages++; done++;
          } catch (error) {
            uploadFailures++; uploadHalted = true;
            emit('SYNC_PACKAGE_UPLOAD_FAILED', { format: 1, eventId: item.eventId, sequence: item.localSequence, error: error && error.message || String(error) });
            break;
          }
          current.progress = { ...current.progress, stage: 'Legacy paket doğrulanıyor', uploadDone: done, packageDone: done, bytesDone: networkBytesWritten, totalRemaining: Math.max(0, pendingTotal - done), speedBytesPerSecond: Math.round(networkBytesWritten / Math.max(1, (Date.now() - startedAt) / 1000)), etaSeconds: done && done < pending.length ? Math.ceil((pending.length - done) / (done / Math.max(1, (Date.now() - startedAt) / 1000))) : null };
          notifyState({ ...current, networkBytesWritten }, done === pending.length);
        }
      } else {
        const bundleRoot = path.join(deviceRoot, SYNC_PACKAGE_DIR);
        if (packageBuild.packages.length) await net(() => fsp.mkdir(bundleRoot, { recursive: true }), 'Bundle klasörü oluşturma');
        let eventDone = 0, packageDone = 0;
        for (const bundle of packageBuild.packages) {
          const target = path.join(bundleRoot, gzipBundleMode ? gzipBundleFileName(bundle) : bundleFileName(bundle));
          const networkWriteStartedAt = Date.now();
          try {
            let exists = false;
            try {
              const existingRead = await net(() => readSyncJson(target), 'Bundle varlık kontrolü');
              const existing = validateSyncPackage(existingRead.payload);
              exists = existing.packageId === bundle.manifest.packageId;
            } catch (error) { if (error.code !== 'ENOENT') exists = false; }
            const ioMetrics = {};
            if (!exists) networkBytesWritten += await net(() => (gzipBundleMode ? writeValidatedGzipJson(target, bundle.manifest, metrics => Object.assign(ioMetrics, metrics)) : writeValidatedJson(target, bundle.manifest, metrics => Object.assign(ioMetrics, metrics))), 'Bundle yükleme');
            networkBytesWritten += await writeHead(deviceRoot, deviceId, bundle.lastSeq, SYNC_PACKAGE_VERSION);
            await localDb.markSynced(bundle.sourceEventIds);
            uploadedEvents += bundle.sourceEventCount; uploadedPackages++; eventDone += bundle.sourceEventCount; packageDone++;
            emit('SYNC_PACKAGE_UPLOADED', { format: gzipBundleMode ? 'v2-gzip' : 'v2-json', packageId: bundle.manifest.packageId, events: bundle.sourceEventCount, transportEvents: bundle.manifest.eventCount, firstSeq: bundle.firstSeq, lastSeq: bundle.lastSeq, existing: exists, networkWriteMs: Date.now() - networkWriteStartedAt, writeMs: Number(ioMetrics.writeMs) || 0, verificationMs: Number(ioMetrics.verificationMs) || 0, renameMs: Number(ioMetrics.renameMs) || 0, bytes: Number(ioMetrics.bytes) || 0 });
          } catch (error) {
            uploadFailures++; uploadHalted = true;
            emit('SYNC_PACKAGE_UPLOAD_FAILED', { format: 2, packageId: bundle.manifest.packageId, firstSeq: bundle.firstSeq, lastSeq: bundle.lastSeq, error: error && error.message || String(error) });
            break;
          }
          current.progress = { ...current.progress, stage: 'Paket doğrulanıyor', uploadDone: eventDone, packageDone, bytesDone: networkBytesWritten, totalRemaining: Math.max(0, pendingTotal - eventDone), speedBytesPerSecond: Math.round(networkBytesWritten / Math.max(1, (Date.now() - startedAt) / 1000)), etaSeconds: eventDone && eventDone < pending.length ? Math.ceil((pending.length - eventDone) / (eventDone / Math.max(1, (Date.now() - startedAt) / 1000))) : null };
          notifyState({ ...current, networkBytesWritten }, packageDone === packageTotal);
        }
      }

      const state = await localDb.read(), checkpoints = state.syncCheckpoints || {}, sources = [];
      let corruptPackages = 0, sourceDevices = [], scannedPackages = 0, skippedDeviceFolders = 0;
      try { sourceDevices = await net(() => fsp.readdir(changesRoot, { withFileTypes: true }), 'Cihaz listesi okuma'); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
      for (const source of sourceDevices) {
        if (!source.isDirectory() || source.name === encode(deviceId)) continue;
        const sourceId = decode(source.name), sourceRoot = path.join(changesRoot, source.name); let head = null;
        const checkpoint = Number(checkpoints[sourceId]) || 0;
        try { head = await net(() => readJson(path.join(sourceRoot, NETWORK_HEAD_FILE)), 'Checkpoint head okuma'); }
        catch (error) { if (error.code !== 'ENOENT') throw error; }
        if (head && Number(head.latestSequence) <= checkpoint) { skippedDeviceFolders++; continue; }

        let v1Names = [], v2Names = [];
        try { v1Names = (await net(() => fsp.readdir(sourceRoot), 'Legacy paket listesi okuma')).filter(name => name !== NETWORK_HEAD_FILE && (name.endsWith(READY_PACKAGE_SUFFIX) || name.endsWith('.json'))); }
        catch (error) { if (error.code !== 'ENOENT') throw error; }
        try { v2Names = (await net(() => fsp.readdir(path.join(sourceRoot, SYNC_PACKAGE_DIR)), 'Bundle listesi okuma')).filter(name => isBundleFile(name)); }
        catch (error) { if (error.code !== 'ENOENT') throw error; }
        scannedPackages += v1Names.length + v2Names.length;
        for (const name of v1Names) {
          const sequence = Number(String(name).split('-', 1)[0]) || 0;
          if (sequence > checkpoint || !sequence) sources.push({ type: 'v1', sourceId, name, sequence, file: path.join(sourceRoot, name) });
        }
        for (const name of v2Names) {
          const sequence = sequenceFromBundleFile(name);
          if (sequence > checkpoint || !sequence) sources.push({ type: 'v2', sourceId, name, sequence, file: path.join(sourceRoot, SYNC_PACKAGE_DIR, name) });
        }
      }
      sources.sort((a, b) => a.sourceId.localeCompare(b.sourceId) || Number(a.sequence) - Number(b.sequence) || a.type.localeCompare(b.type));
      emit('SYNC_CHECKPOINT_EVALUATED', { deviceFolders: sourceDevices.filter(item => item.isDirectory()).length, skippedDeviceFolders, scannedPackages, newPackages: sources.length });

      const legacyRoot = path.join(root, 'delta'); let legacyNames = [];
      if (!current.legacyScanComplete) {
        const legacyScanStartedAt = Date.now(); emit('LEGACY_SYNC_SCAN_START', { root: legacyRoot });
        try { legacyNames = (await net(() => fsp.readdir(legacyRoot), 'Legacy root listesi okuma')).filter(name => name.endsWith('.json')); }
        catch (error) { if (error.code !== 'ENOENT') throw error; }
        emit('LEGACY_SYNC_SCAN_COMPLETE', { packages: legacyNames.length, durationMs: Date.now() - legacyScanStartedAt });
        scannedPackages += legacyNames.length;
      }
      for (const name of legacyNames) sources.push({ type: 'v1', sourceId: 'legacy', name, sequence: 0, file: path.join(legacyRoot, name) });
      emit('NETWORK_SCAN_COMPLETE', { scannedPackages, skippedDeviceFolders, newPackages: sources.length });

      current.progress = { ...current.progress, phase: 'download', stage: 'Değişiklikler okunuyor', downloadDone: 0, downloadTotal: sources.length, packageDone: 0, packageTotal: sources.length, eventDone: 0, bytesDone: 0, bytesTotal: 0, speedBytesPerSecond: 0, etaSeconds: null };
      notifyState({ ...current, networkBytesRead, networkBytesWritten }, true);
      let applied = 0, conflicts = 0;
      for (const source of sources) {
        try {
          const sourceRead = await net(() => readSyncJson(source.file), 'Paket indirme');
          networkBytesRead += sourceRead.bytes;
          const payload = sourceRead.payload;
          if (source.type === 'v2') {
            const pkg = validateSyncPackage(payload);
            if (pkg.deviceId !== source.sourceId) throw new Error('Sync package source device does not match folder.');
            // Collection business belgeleri eski genel delta akışından
            // bilinçli olarak ayrılır. Filtre, paketi yerel DB'ye uygulamadan
            // ÖNCE çalışır; böylece yetkisiz veri diskte/bellekte oluşmaz.
            const incomingEvents = typeof filterIncomingDeltas === 'function' ? filterIncomingDeltas(pkg.events) : pkg.events;
            const result = typeof localDb.applyPackage === 'function'
              ? await localDb.applyPackage({ packageId: pkg.packageId, sourceDeviceId: pkg.deviceId, firstSeq: pkg.firstSeq, lastSeq: pkg.lastSeq, events: incomingEvents })
              : await localDb.applyDeltas(incomingEvents);
            applied += Number(result.applied) || 0;
            conflicts += Array.isArray(result.conflicts) ? result.conflicts.length : 0;
            checkpoints[source.sourceId] = Math.max(Number(checkpoints[source.sourceId]) || 0, Number(result.checkpoint) || 0);
            const ackFile = path.join(ackRoot, encode(pkg.deviceId), 'packages', encode(pkg.packageId), `${encode(deviceId)}.json`);
            const ackStartedAt = Date.now(), ackMetrics = {};
            networkBytesWritten += await net(() => writeValidatedJson(ackFile, { version: 2, sourceDevice: pkg.deviceId, packageId: pkg.packageId, lastSeq: Number(pkg.lastSeq) || 0, deviceId, acknowledgedAt: new Date().toISOString() }, metrics => Object.assign(ackMetrics, metrics)), 'Package ACK yazma');
            emit('SYNC_PACKAGE_ACK_WRITTEN', { packageId: pkg.packageId, sourceDevice: pkg.deviceId, lastSeq: Number(pkg.lastSeq) || 0, ackMs: Date.now() - ackStartedAt, verificationMs: Number(ackMetrics.verificationMs) || 0, bytes: Number(ackMetrics.bytes) || 0 });
            // Compact checkpoint ACK coexists with package ACK during rollout.
            // It records only the highest contiguous sequence, never a max over
            // gaps, so a missing package cannot be acknowledged accidentally.
            const checkpointAck = path.join(ackRoot, encode(pkg.deviceId), `${encode(deviceId)}.json`);
            networkBytesWritten += await net(() => writeValidatedJson(checkpointAck, { version: 2, sourceDevice: pkg.deviceId, readerDevice: deviceId, lastContiguousSequence: Number(checkpoints[source.sourceId]) || 0, updatedAt: new Date().toISOString() }), 'Checkpoint ACK yazma');
            downloadedEvents += Number(pkg.sourceEventCount) || pkg.events.length; downloadedPackages++;
          } else {
            const delta = payload;
            if (!delta || !delta.eventId || (delta.sha256 && checksum(delta) !== String(delta.sha256))) throw new Error('Delta checksum doğrulanamadı.');
            const allowed = typeof filterIncomingDeltas !== 'function' || filterIncomingDeltas([delta]).length === 1;
            const result = allowed ? await localDb.applyDelta(delta) : { applied: false, conflicts: [] }; if (result.applied) applied++;
            conflicts += Array.isArray(result.conflicts) ? result.conflicts.length : 0;
            if (source.sourceId !== 'legacy' && source.sequence) { const afterDelta = await localDb.read(); checkpoints[source.sourceId] = Number(afterDelta.syncCheckpoints && afterDelta.syncCheckpoints[source.sourceId]) || Number(checkpoints[source.sourceId]) || 0; }
            if (delta.deviceId && delta.deviceId !== deviceId) {
              const ackFile = path.join(ackRoot, encode(delta.deviceId), encode(delta.eventId), `${encode(deviceId)}.json`);
              networkBytesWritten += await net(() => writeValidatedJson(ackFile, { eventId: delta.eventId, sourceDeviceId: delta.deviceId, deviceId, acknowledgedAt: new Date().toISOString() }), 'ACK yazma');
            }
            downloadedEvents++; downloadedPackages++;
          }
        } catch (error) {
          if (error.code === 'SYNC_NETWORK_TIMEOUT') throw error;
          corruptPackages++;
        }
        current.progress = { ...current.progress, stage: 'Değişiklik uygulanıyor', downloadDone: downloadedPackages, packageDone: downloadedPackages, eventDone: downloadedEvents, bytesDone: networkBytesRead, speedBytesPerSecond: Math.round(networkBytesRead / Math.max(1, (Date.now() - startedAt) / 1000)), etaSeconds: downloadedPackages && downloadedPackages < sources.length ? Math.ceil((sources.length - downloadedPackages) / (downloadedPackages / Math.max(1, (Date.now() - startedAt) / 1000))) : null };
        notifyState({ ...current, networkBytesRead, networkBytesWritten }, downloadedPackages === sources.length);
      }

      await acknowledgeLocalUploads(ackRoot, deviceId);
      const prunedPackages = await prunePackages(deviceRoot, ackRoot, deviceId, current.packageRetentionDays);
      const finalState = await localDb.read(), finalConflicts = Array.isArray(finalState.conflicts) ? finalState.conflicts.filter(item => !item.resolved).length : 0;
      const warningParts = [];
      if (uploadFailures) warningParts.push(`${uploadFailures} paket yüklenemedi, bir sonraki sync'te kalan event'lerden devam edilecek.`);
      if (uploadHalted) warningParts.push('Yükleme ilk başarısız pakette durduruldu; başarılı paketler checkpoint edildi.');
      if (corruptPackages) warningParts.push(`${corruptPackages} bozuk sync paketi atlandı.`);
      const warning = warningParts.length ? warningParts.join(' ') : null;
      let localSnapshotDate = null;
      try { localSnapshotDate = (await fsp.stat(localDb.getFile ? localDb.getFile() : localDb.file)).mtime.toISOString(); } catch (_) {}
      const pendingAck = typeof localDb.unacknowledgedCount === 'function' ? await localDb.unacknowledgedCount() : (await localDb.unacknowledged(10000)).length;
      const result = await write({ ...current, online: true, lastSync: warning ? current.lastSync : new Date().toISOString(), nextSync: current.syncPeriodMinutes === 'manual' ? null : new Date(Date.now() + Number(current.syncPeriodMinutes || 5) * 60000).toISOString(), pendingUpload: (await localDb.pendingCount()), pendingAck, pendingDownload: 0, conflict: Math.max(finalConflicts, conflicts), corruptPackages, uploadFailures, checkpoint: finalState.syncCheckpoints || checkpoints, retries: 0, progress: null, lastError: warning, downloadedEvents, uploadedEvents, downloadedPackages, uploadedPackages, lastDurationMs: Date.now() - startedAt, networkBytesRead, networkBytesWritten, localSnapshotDate, scannedPackages, skippedDeviceFolders, legacyScanComplete: true, prunedPackages, lastPruneAt: prunedPackages ? new Date().toISOString() : current.lastPruneAt, legacyCompatibilityMode, legacyPeerDevices, gzipBundleMode, gzipUnsupportedPeerDevices, protocolVersion: 2, checkpointAckSupport: true });
      notifyState(result, true); clearRuntimeState();
      emit('SYNC_COMPLETE', { online: true, durationMs: result.lastDurationMs, downloadedEvents, uploadedEvents, downloadedPackages, uploadedPackages, legacyCompatibilityMode, gzipBundleMode });
      return result;
    } catch (error) {
      let pendingUpload = 0, pendingAck = 0;
      try { pendingUpload = await localDb.pendingCount(); } catch (_) {}
      try { pendingAck = typeof localDb.unacknowledgedCount === 'function' ? await localDb.unacknowledgedCount() : (await localDb.unacknowledged(10000)).length; } catch (_) {}
      const failed = { ...current, online: false, retries: Number(current.retries || 0) + 1, progress: null, lastError: error.message || String(error), pendingUpload, pendingAck, uploadedEvents, downloadedEvents, uploadedPackages, downloadedPackages, networkBytesRead, networkBytesWritten, lastDurationMs: Date.now() - startedAt };
      try {
        const result = await write(failed); notifyState(result, true); clearRuntimeState();
        emit('SYNC_COMPLETE', { online: false, durationMs: result.lastDurationMs, error: result.lastError, uploadedEvents, uploadedPackages }); return result;
      } catch (statusError) {
        const statusMessage = statusError && (statusError.message || String(statusError));
        const result = { ...failed, lastError: `${failed.lastError}; Sync durumu kaydedilemedi: ${statusMessage}` };
        notifyState(result, true); clearRuntimeState();
        emit('SYNC_COMPLETE', { online: false, durationMs: result.lastDurationMs, error: result.lastError, statusPersisted: false }); return result;
      }
    }
  }
  async function syncOnce() {
    if (paused) return read();
    if (syncInFlight) return syncInFlight;
    syncInFlight = runSyncOnce();
    try { return await syncInFlight; } finally { syncInFlight = null; }
  }
  return { read, save, savePeriod, saveRetentionDays, restoreMetadata, pause, resume, isPaused, waitForIdle, testConnection, syncOnce, onStateChange: subscribeStateChange, file, PACKAGE_RETENTION_CHOICES };
}

module.exports = { createSyncSettings, PACKAGE_RETENTION_CHOICES, DEFAULT_PACKAGE_RETENTION_DAYS, normalizeRetentionDays, SYNC_PACKAGE_VERSION, SYNC_PACKAGE_MAX_EVENTS, SYNC_PACKAGE_MAX_BYTES };

'use strict';

/*
 * DATA TEMİZLİĞİ — kurulum klasörü ve Shared Sync klasöründeki gereksiz
 * dosyaları bulur, özetler ve yalnız kullanıcının seçtiklerini siler.
 *
 * İki kapsam vardır:
 *   local → Buyer Log'un kurulu olduğu klasör (BuyerLog.exe'nin yanı) ve
 *           yeniden üretilebilir yerel önbellekler. Her kullanıcı çalıştırır.
 *   sync  → Shared Hub (ortak sync klasörü). YALNIZ Moderatör çalıştırır;
 *           yetki route katmanında ve burada (assertScope) iki kez denetlenir.
 *
 * Güvenlik kuralları (değişmez):
 *   1) Silme listesini istemci DEĞİL sunucu üretir. Uygulama adımında plan
 *      yeniden kurulur ve yalnız taze plandaki kimlikler silinir; istemcinin
 *      gönderdiği yol asla doğrudan kullanılmaz.
 *   2) Aktif bir kökü (çalışan uygulama çekirdeği, iş verisi kökleri, yerel
 *      DB, BuyerLog.exe, sync klasörü) İÇEREN ya da ona EŞİT hiçbir yol aday
 *      olamaz (isProtected).
 *   3) Başka kullanıcıların kullandığı veri korunur: senkron paketleri,
 *      ack/cihaz klasörleri, IAM/master/business checkpoint'lerinin referanslı
 *      nesilleri, model görselleri. Her kullanıcının SON yedeği korunur.
 *   4) Tanınmayan öğeler listelenir ama varsayılan olarak SEÇİLİ GELMEZ;
 *      kullanıcı görmeden hiçbir bilinmeyen dosya silinmez.
 */

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const { walkStats } = require('./data-maintenance');

const DAY_MS = 86400000;
const TEMP_AGE_MS = DAY_MS;
const CHECKPOINT_KEEP = 3;
const WEEK_MS = 7 * DAY_MS;
// Hatırlatma yalnız kayda değer miktarda temizlenebilir veri varsa gösterilir.
const REMINDER_MIN_BYTES = 100 * 1024 * 1024;
/*
 * Sormadan silinebilecek, Buyer Log'un KENDİ ürettiği zararsız bayat veri.
 * Hepsi yeniden üretilebilir ya da yarım kalmış iş artığıdır; kullanıcı
 * dosyası, yedek, kurulum arşivi, tanınmayan öğe ve sync klasörü ASLA bu
 * listeye girmez. Tarayıcı önbelleği açık bir oturum tarafından kullanılıyor
 * olabileceği için otomatik temizliğe alınmadı.
 */
const AUTO_CLEAN_REASONS = new Set(['app-temp', 'partial-update', 'rebuildable-cache', 'old-log', 'expired-export', 'old-app-version', 'old-update-package']);
function isAutoCleanable(item) { return Boolean(item && item.selected && AUTO_CLEAN_REASONS.has(item.reason) && item.kind !== 'browser-cache'); }
const ARCHIVE_RE = /\.(zip|7z|rar|tar|tgz|gz|bz2|xz|cab)$/i;
const INSTALLER_RE = /\.(exe|msi|msix|msixbundle|appx|appinstaller)$/i;
const SETUP_NAME_RE = /setup|install|kurulum|update|guncelle|güncelle|portable|\d+\.\d+\.\d+/i;
const TEMP_FILE_RE = /(?:\.(?:tmp|temp|partial|crdownload|part|dmp|old)$|\.tmp\.|\.partial-|^~\$|^thumbs\.db$)/i;
const ROOT_DEBRIS_RE = /\.(?:log|bak)$/i;
const RUNTIME_EXT_RE = /\.(?:dll|pak|bin|dat)$/i;
const DOC_RE = /\.(?:md|txt)$/i;
const LAUNCHER_RE = /^(?:start-buyer-log|buyerlog[-_ ].*)\.(?:cmd|bat|ps1|vbs)$/i;
const DATA_BACKUP_RE = /^data[-_ ]?backup(?:[-_ ].*)?$/i;
// Electron/Chromium çalışma dosyaları ve Buyer Log'un kendi kurulum öğeleri.
const RUNTIME_NAMES = new Set([
  'locales', 'resources', 'version', 'license', 'license.txt', 'licenses.chromium.html', 'vk_swiftshader_icd.json',
  'data', 'config.json', 'manifest.json', 'docs', 'desktop.ini', 'buyerlog.exe', 'buyer log.exe', 'buyerlog.ico',
]);
const DEV_ARTIFACTS = ['dist-updates', 'dist-installer', '.release-pending.json', 'coverage'];

function resolved(value) { return value ? path.resolve(String(value)) : ''; }
function isInside(root, target) {
  const rel = path.relative(resolved(root), resolved(target));
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}
function commonDir(paths) {
  const split = paths.map(p => path.dirname(resolved(p)).split(path.sep));
  const out = [];
  for (let i = 0; i < split[0].length; i += 1) { const seg = split[0][i]; if (split.every(parts => parts[i] === seg)) out.push(seg); else break; }
  return out.join(path.sep) || path.sep;
}
function idFor(scope, key) { return crypto.createHash('sha1').update(`${scope}\n${resolved(key) || key}`).digest('hex').slice(0, 20); }
function cleanupError(message, code, statusCode = 409) { return Object.assign(new Error(message), { code, statusCode }); }
async function statSafe(file) { try { return await fsp.stat(file); } catch (_) { return null; } }
async function lstatSafe(file) { try { return await fsp.lstat(file); } catch (_) { return null; } }
async function readdirSafe(dir) { try { return await fsp.readdir(dir, { withFileTypes: true }); } catch (_) { return []; } }
async function readJsonSafe(file) {
  try { let text = await fsp.readFile(file, 'utf8'); if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1); return JSON.parse(text); } catch (_) { return null; }
}

/*
 * Kurulum kökü: masaüstü barındırıcısı backend'e BUYER_LOG_PORTABLE_DATA_ROOT
 * (= <kök>\data) verir. Çalışan çekirdek .buyerlog-versions altında olabileceği
 * için __dirname'den türetmek güvenilir değildir; yalnız klasik
 * <kök>\resources\app düzeninde, kökte Electron "version" dosyası varsa
 * yedek olarak kullanılır.
 */
function resolveInstallRoot({ env = process.env, projectRoot = '' } = {}) {
  const portableData = String(env.BUYER_LOG_PORTABLE_DATA_ROOT || '').trim();
  if (portableData) return path.dirname(path.resolve(portableData));
  if (projectRoot) {
    const app = path.resolve(projectRoot), resources = path.dirname(app), root = path.dirname(resources);
    if (path.basename(app).toLowerCase() === 'app' && path.basename(resources).toLowerCase() === 'resources' && fs.existsSync(path.join(root, 'version'))) return root;
  }
  return '';
}

function createDataCleanup({
  roots, installRoot = '', portableDataRoot = '', tempRoot = '', execPath = process.execPath, appVersion = '',
  syncSettings = null, sharedHub = null, dataMaintenance = null, extraProtected = [], now = () => Date.now(), stateFile = '',
} = {}) {
  if (!roots) throw new Error('data-cleanup requires roots.');
  const installDir = resolved(installRoot);
  const dataDir = resolved(portableDataRoot) || (installDir ? path.join(installDir, 'data') : '');
  const tempDir = resolved(tempRoot) || (dataDir ? path.join(dataDir, 'temp') : '');
  const baseProtected = [roots.projectRoot, roots.serverDataRoot, roots.appDataRoot, roots.localDataRoot, roots.localDbPath, execPath, ...extraProtected].filter(Boolean).map(resolved);

  async function protectedPaths() {
    const list = [...baseProtected];
    if (syncSettings) { try { const s = await syncSettings.read(); if (s && s.sharedSyncRoot) list.push(resolved(s.sharedSyncRoot)); } catch (_) {} }
    return list;
  }
  // Aday, korunan bir yolu içeriyor ya da ona eşitse silinemez.
  function isProtected(candidate, list) { return list.some(p => isInside(candidate, p)); }

  async function sizeOf(target) {
    const st = await walkStats(target);
    return { size: st.bytes, files: st.files };
  }
  function makeItem(scope, { key, target, paths = null, kind, reason, selected, size = 0, files = 0, mtimeMs = 0, owner = '' }) {
    return {
      id: idFor(scope, key || target), path: resolved(target), kind, reason, selected: Boolean(selected),
      size: Number(size) || 0, files: Number(files) || 0, mtimeMs: Number(mtimeMs) || 0, owner, paths,
    };
  }

  /* ---------------- LOCAL: kurulum klasörü ---------------- */

  async function looksLikeOldCopy(dir) {
    for (const marker of [['resources', 'app', 'package.json'], ['BuyerLog.exe'], ['app', 'package.json']]) {
      if (await statSafe(path.join(dir, ...marker))) return true;
    }
    return false;
  }
  async function recentlyUsedData(dir) {
    for (const rel of [['data', 'local', 'BuyerLogLocal.db'], ['local', 'BuyerLogLocal.db']]) {
      const st = await statSafe(path.join(dir, ...rel));
      if (st && now() - st.mtimeMs < 7 * DAY_MS) return true;
    }
    return false;
  }

  async function scanInstallRoot(items, kept, guard) {
    if (!installDir || !(await statSafe(installDir))) return;
    const execName = path.basename(String(execPath || '')).toLowerCase();
    const execInRoot = execPath && path.dirname(resolved(execPath)) === installDir;
    const isDevCheckout = Boolean(await statSafe(path.join(installDir, '.git')));
    const backups = [];
    let runtimeBytes = 0, runtimeFiles = 0;
    for (const entry of await readdirSafe(installDir)) {
      const name = entry.name, lower = name.toLowerCase(), full = path.join(installDir, name);
      if (entry.isSymbolicLink()) continue;
      const st = await lstatSafe(full); if (!st) continue;
      const isDir = st.isDirectory();
      const keepRuntime = name.startsWith('.') || RUNTIME_NAMES.has(lower) || (!isDir && (RUNTIME_EXT_RE.test(name) || DOC_RE.test(name) || LAUNCHER_RE.test(name) || /^license/i.test(name)))
        || (execInRoot && lower === execName);
      if (keepRuntime || isProtected(full, guard)) {
        if (lower !== 'data' && !name.startsWith('.')) { const s = isDir ? await sizeOf(full) : { size: st.size, files: 1 }; runtimeBytes += s.size; runtimeFiles += s.files; }
        continue;
      }
      if (isDir && DATA_BACKUP_RE.test(name)) { backups.push({ full, mtimeMs: st.mtimeMs }); continue; }
      const s = isDir ? await sizeOf(full) : { size: st.size, files: 1 };
      let kind = 'unknown', reason = 'unknown-install-item', selected = false;
      if (!isDir && ARCHIVE_RE.test(name)) { kind = 'archive'; reason = 'setup-archive'; selected = true; }
      // Adı kurulum/güncelleme paketine benzemeyen .exe başka bir aracın
      // kendisi olabilir: listelenir ama varsayılan olarak seçilmez.
      else if (!isDir && INSTALLER_RE.test(name)) { kind = 'installer'; reason = 'setup-installer'; selected = SETUP_NAME_RE.test(name) || !/\.exe$/i.test(name); }
      else if (!isDir && (TEMP_FILE_RE.test(name) || ROOT_DEBRIS_RE.test(name))) { kind = 'temp'; reason = 'temp-file'; selected = true; }
      else if (isDir && await looksLikeOldCopy(full)) {
        if (await recentlyUsedData(full)) { kind = 'unknown'; reason = 'copy-recently-used'; selected = false; }
        else { kind = 'old-copy'; reason = 'old-install-copy'; selected = true; }
      }
      items.push(makeItem('local', { target: full, kind, reason, selected, size: s.size, files: s.files, mtimeMs: st.mtimeMs }));
    }
    // Yedek kopyalar: en yenisi her zaman korunur.
    backups.sort((a, b) => b.mtimeMs - a.mtimeMs);
    for (const [index, backup] of backups.entries()) {
      const s = await sizeOf(backup.full);
      if (index === 0) { kept.push({ label: 'latest-data-backup', path: backup.full, size: s.size, files: s.files }); continue; }
      items.push(makeItem('local', { target: backup.full, kind: 'stale-backup', reason: 'older-data-backup', selected: true, size: s.size, files: s.files, mtimeMs: backup.mtimeMs }));
    }
    if (runtimeFiles) kept.push({ label: 'program-files', path: installDir, size: runtimeBytes, files: runtimeFiles });

    // Geliştirici/release çıktıları — kaynak deposu checkout'unda dokunulmaz.
    if (!isDevCheckout) {
      for (const rel of DEV_ARTIFACTS) {
        const full = path.join(installDir, 'resources', 'app', rel), st = await lstatSafe(full);
        if (!st || st.isSymbolicLink() || isProtected(full, guard)) continue;
        const s = st.isDirectory() ? await sizeOf(full) : { size: st.size, files: 1 };
        items.push(makeItem('local', { target: full, kind: 'dev-artifact', reason: 'build-output', selected: true, size: s.size, files: s.files, mtimeMs: st.mtimeMs }));
      }
    }
    await scanUpdater(items, guard);
  }

  /* Güncelleyici: aktif, son sağlam ve bekleyen sürüm dışındaki çekirdekler,
     önbellek zip'leri ve yarım kalan açma klasörleri. Durum okunamazsa
     yalnız yarım kalan (.partial) dosyalar aday olur. */
  async function scanUpdater(items, guard) {
    const state = await readJsonSafe(path.join(roots.localDataRoot || '', 'updater', 'state.json'));
    const keep = new Set([appVersion, state && state.currentVersion, state && state.lastKnownGoodVersion, state && state.pending && state.pending.version].filter(Boolean).map(String));
    const stateKnown = Boolean(state && state.schemaVersion === 1);
    const key = version => String(version).replace(/[^0-9A-Za-z._-]/g, '_');
    const versionsRoot = path.join(installDir, '.buyerlog-versions');
    if (stateKnown) {
      for (const entry of await readdirSafe(versionsRoot)) {
        if (!entry.isDirectory()) continue;
        const full = path.join(versionsRoot, entry.name);
        if (keep.has(entry.name) || isProtected(full, guard)) continue;
        if (state.pending && state.pending.versionRoot && resolved(state.pending.versionRoot) === resolved(full)) continue;
        const release = await readJsonSafe(path.join(full, 'release.json'));
        const partial = entry.name.includes('.partial');
        if (!partial && release && keep.has(String(release.version))) continue;
        const st = await statSafe(full), s = await sizeOf(full);
        items.push(makeItem('local', { target: full, kind: partial ? 'temp' : 'old-version', reason: partial ? 'partial-update' : 'old-app-version', selected: true, size: s.size, files: s.files, mtimeMs: st && st.mtimeMs }));
      }
    }
    const opsRoot = path.join(installDir, '.buyerlog-updater');
    for (const entry of await readdirSafe(path.join(opsRoot, 'cache'))) {
      const full = path.join(opsRoot, 'cache', entry.name), partial = entry.name.includes('.partial');
      if (!partial && (!stateKnown || [...keep].some(v => entry.name.startsWith(key(v) + '-')))) continue;
      const st = await statSafe(full); if (!st) continue;
      const s = st.isDirectory() ? await sizeOf(full) : { size: st.size, files: 1 };
      items.push(makeItem('local', { target: full, kind: partial ? 'temp' : 'old-version', reason: partial ? 'partial-update' : 'old-update-package', selected: true, size: s.size, files: s.files, mtimeMs: st.mtimeMs }));
    }
    for (const entry of await readdirSafe(path.join(opsRoot, 'staging'))) {
      const full = path.join(opsRoot, 'staging', entry.name), st = await statSafe(full);
      if (!st || now() - st.mtimeMs < TEMP_AGE_MS) continue;
      const s = st.isDirectory() ? await sizeOf(full) : { size: st.size, files: 1 };
      items.push(makeItem('local', { target: full, kind: 'temp', reason: 'partial-update', selected: true, size: s.size, files: s.files, mtimeMs: st.mtimeMs }));
    }
  }

  /* Uygulamanın kendi geçici klasörü (data\temp): 24 saatten eski öğeler. */
  async function scanAppTemp(items, guard) {
    if (!tempDir) return;
    const paths = []; let size = 0, files = 0;
    for (const entry of await readdirSafe(tempDir)) {
      const full = path.join(tempDir, entry.name), st = await lstatSafe(full);
      if (!st || st.isSymbolicLink() || now() - st.mtimeMs < TEMP_AGE_MS || isProtected(full, guard)) continue;
      const s = st.isDirectory() ? await sizeOf(full) : { size: st.size, files: 1 };
      paths.push(full); size += s.size; files += s.files;
    }
    if (paths.length) items.push(makeItem('local', { key: `app-temp:${tempDir}`, target: tempDir, paths, kind: 'temp', reason: 'app-temp', selected: true, size, files }));
  }

  /* Mevcut Safe Clean planı (sayfa önbelleği, tarayıcı önbelleği, süresi
     dolmuş exportlar, eski loglar, bayat geçici dosyalar) kategori başına tek
     satır olarak eklenir. Oturum/iş verisi o planın kendi kuralıyla dışarıda. */
  async function scanSafeClean(items, guard) {
    if (!dataMaintenance || typeof dataMaintenance.buildSafeCleanPlan !== 'function') return;
    let plan; try { plan = await dataMaintenance.buildSafeCleanPlan({ scope: 'all', nowMs: now() }); } catch (_) { return; }
    const groups = new Map();
    for (const file of plan.files || []) {
      if (isProtected(file.path, guard)) continue;
      const group = groups.get(file.category) || { paths: [], size: 0 };
      group.paths.push(resolved(file.path)); group.size += Number(file.size) || 0; groups.set(file.category, group);
    }
    const kindOf = category => /^Browser/.test(category) ? 'browser-cache' : /Export/.test(category) ? 'export' : /Log/.test(category) ? 'log' : /Temp/.test(category) ? 'temp' : 'cache';
    for (const [category, group] of groups) {
      const kind = kindOf(category);
      items.push(makeItem('local', { key: `safe-clean:${category}`, target: path.dirname(group.paths[0]), paths: group.paths, kind, reason: kind === 'export' ? 'expired-export' : kind === 'log' ? 'old-log' : kind === 'temp' ? 'temp-file' : 'rebuildable-cache', selected: true, size: group.size, files: group.paths.length }));
    }
  }

  /* ---------------- SYNC: Shared Hub ---------------- */

  async function hubContext() {
    const settings = syncSettings ? await syncSettings.read() : null;
    if (!settings || !settings.sharedSyncRoot) throw cleanupError('Shared Sync folder is not configured.', 'SYNC_NOT_CONFIGURED');
    if (!sharedHub) throw cleanupError('Shared Hub is unavailable.', 'SYNC_HUB_UNAVAILABLE', 503);
    const checked = await sharedHub.validate(settings.sharedSyncRoot, { requireWrite: false });
    const layout = { iam: 'iam', sync: 'BUYER_LOG_SYNC', master: 'master', business: 'business', images: 'model-images', personalBackups: 'personal-backups', ...((checked.manifest && checked.manifest.layout) || {}) };
    return { root: resolved(checked.root), layout, settings };
  }

  async function scanPersonalBackups(hub, items, kept) {
    const area = path.join(hub.root, hub.layout.personalBackups);
    for (const user of await readdirSafe(area)) {
      if (!user.isDirectory()) continue;
      const dir = path.join(area, user.name);
      const latest = await readJsonSafe(path.join(dir, 'latest.json'));
      const zips = [];
      for (const entry of await readdirSafe(dir)) {
        if (!entry.isFile()) continue;
        const full = path.join(dir, entry.name), st = await statSafe(full); if (!st) continue;
        if (/\.zip$/i.test(entry.name)) zips.push({ name: entry.name, full, size: st.size, mtimeMs: st.mtimeMs });
        else if (TEMP_FILE_RE.test(entry.name) && now() - st.mtimeMs > TEMP_AGE_MS) items.push(makeItem('sync', { target: full, kind: 'temp', reason: 'temp-file', selected: true, size: st.size, files: 1, mtimeMs: st.mtimeMs, owner: user.name }));
      }
      zips.sort((a, b) => b.mtimeMs - a.mtimeMs || b.name.localeCompare(a.name));
      const keepNames = new Set([latest && path.basename(String(latest.filename || '')), zips[0] && zips[0].name].filter(Boolean));
      for (const zip of zips) {
        if (keepNames.has(zip.name)) { kept.push({ label: 'latest-user-backup', path: zip.full, size: zip.size, files: 1, owner: user.name }); continue; }
        items.push(makeItem('sync', { target: zip.full, kind: 'stale-backup', reason: 'older-user-backup', selected: true, size: zip.size, files: 1, mtimeMs: zip.mtimeMs, owner: user.name }));
      }
    }
  }

  /* Checkpoint nesilleri: current.json'ın referans verdiği iki nesil ve en
     yeni CHECKPOINT_KEEP dosya korunur (shared-hub cleanupCheckpointFiles ile
     aynı politika). */
  async function scanCheckpoints(hub, items) {
    const queue = [{ dir: hub.root, depth: 0 }];
    while (queue.length) {
      const { dir, depth } = queue.shift();
      for (const entry of await readdirSafe(dir)) {
        if (!entry.isDirectory()) continue;
        const full = path.join(dir, entry.name);
        if (entry.name === 'checkpoints') {
          const head = await readJsonSafe(path.join(dir, 'current.json'));
          if (!head) continue;
          const refs = new Set([head.file, head.previous && head.previous.file].filter(Boolean).map(f => path.basename(String(f))));
          const names = (await readdirSafe(full)).filter(e => e.isFile() && e.name.endsWith('.json.gz')).map(e => e.name).sort().reverse();
          for (const name of names.slice(CHECKPOINT_KEEP)) {
            if (refs.has(name)) continue;
            const file = path.join(full, name), st = await statSafe(file); if (!st) continue;
            items.push(makeItem('sync', { target: file, kind: 'stale-checkpoint', reason: 'old-checkpoint', selected: true, size: st.size, files: 1, mtimeMs: st.mtimeMs }));
          }
        } else if (depth < 3 && entry.name !== hub.layout.images && entry.name !== hub.layout.personalBackups) queue.push({ dir: full, depth: depth + 1 });
      }
    }
  }

  /* Hub genelindeki terk edilmiş geçici dosyalar ve bayat yazma kilitleri.
     Başka bir istemcinin şu an yazıyor olabileceği dosyalara dokunmamak için
     24 saatten yeni olanlar atlanır. */
  async function scanHubTemp(hub, items) {
    const paths = []; let size = 0, files = 0;
    const stack = [hub.root];
    let visited = 0;
    while (stack.length && visited < 250000) {
      const dir = stack.pop();
      for (const entry of await readdirSafe(dir)) {
        visited += 1;
        const full = path.join(dir, entry.name);
        if (entry.isSymbolicLink()) continue;
        const stale = async () => { const st = await statSafe(full); return st && now() - st.mtimeMs > TEMP_AGE_MS ? st : null; };
        if (entry.isDirectory()) {
          if (entry.name.endsWith('.write-lock') || /\.partial/.test(entry.name)) {
            const st = await stale(); if (st) { const s = await sizeOf(full); paths.push(full); size += s.size; files += s.files; }
            continue;
          }
          if (dir === hub.root && entry.name === hub.layout.personalBackups) continue; // ayrı taranır
          stack.push(full); continue;
        }
        if (!entry.isFile()) continue;
        if (TEMP_FILE_RE.test(entry.name) || entry.name.startsWith('.buyerlog-hub-probe-')) {
          const st = await stale(); if (st) { paths.push(full); size += st.size; files += 1; }
        }
      }
    }
    if (paths.length) items.push(makeItem('sync', { key: `hub-temp:${hub.root}`, target: hub.root, paths, kind: 'temp', reason: 'abandoned-temp', selected: true, size, files }));
  }

  async function scanHubRoot(hub, items, kept) {
    const known = new Set(['buyerlog-hub.json', 'desktop.ini', ...Object.values(hub.layout).map(v => String(v))].map(v => v.toLowerCase()));
    const labels = { [hub.layout.sync]: 'sync-packages', [hub.layout.iam]: 'shared-iam', [hub.layout.master]: 'shared-master', [hub.layout.business]: 'shared-business', [hub.layout.images]: 'shared-images' };
    for (const entry of await readdirSafe(hub.root)) {
      const name = entry.name, full = path.join(hub.root, name);
      if (entry.isSymbolicLink()) continue;
      if (known.has(name.toLowerCase()) || name.startsWith('.')) {
        if (labels[name]) { const s = await sizeOf(full); kept.push({ label: labels[name], path: full, size: s.size, files: s.files }); }
        continue;
      }
      const st = await lstatSafe(full); if (!st) continue;
      const isDir = st.isDirectory(), s = isDir ? await sizeOf(full) : { size: st.size, files: 1 };
      let kind = 'unknown', reason = 'unknown-sync-item', selected = false;
      if (!isDir && ARCHIVE_RE.test(name)) { kind = 'archive'; reason = 'stray-archive'; selected = true; }
      else if (!isDir && INSTALLER_RE.test(name)) { kind = 'installer'; reason = 'setup-installer'; selected = true; }
      else if (!isDir && (TEMP_FILE_RE.test(name) || ROOT_DEBRIS_RE.test(name))) { kind = 'temp'; reason = 'temp-file'; selected = true; }
      items.push(makeItem('sync', { target: full, kind, reason, selected, size: s.size, files: s.files, mtimeMs: st.mtimeMs }));
    }
  }

  /* ---------------- ortak ---------------- */

  function assertScope(scope, { moderator = false } = {}) {
    if (scope !== 'local' && scope !== 'sync') throw cleanupError('Unknown cleanup scope.', 'CLEANUP_SCOPE_INVALID', 400);
    if (scope === 'sync' && !moderator) throw cleanupError('Only the Moderator can clean the shared sync folder.', 'MODERATOR_REQUIRED', 403);
  }

  async function buildPlan(scope, options = {}) {
    assertScope(scope, options);
    const guard = await protectedPaths();
    const items = [], kept = [];
    let root = '';
    if (scope === 'local') {
      root = installDir;
      await scanInstallRoot(items, kept, guard);
      await scanAppTemp(items, guard);
      await scanSafeClean(items, guard);
    } else {
      const hub = await hubContext();
      root = hub.root;
      await scanHubRoot(hub, items, kept);
      await scanPersonalBackups(hub, items, kept);
      await scanCheckpoints(hub, items);
      await scanHubTemp(hub, items);
      // Hub kökü korunur; kökün kendisi asla aday olamaz.
      for (let i = items.length - 1; i >= 0; i -= 1) if (items[i].path === hub.root && !items[i].paths) items.splice(i, 1);
    }
    const unique = new Map();
    for (const it of items) if (!unique.has(it.id)) unique.set(it.id, it);
    const list = [...unique.values()].sort((a, b) => Number(b.selected) - Number(a.selected) || b.size - a.size);
    // Toplu satırlar (çok dosyalı) dosyaların ortak klasörüyle gösterilir.
    for (const it of list) if (Array.isArray(it.paths) && it.paths.length) it.path = commonDir(it.paths);
    // Görünen yol kök klasöre göre göreli verilir; kökün dışındakiler tam yol kalır.
    const relOf = target => (root && isInside(root, target) ? path.relative(root, target) || '.' : target);
    for (const it of list) it.relPath = relOf(it.path);
    for (const k of kept) k.relPath = relOf(k.path);
    const sum = (arr, key) => arr.reduce((t, x) => t + (Number(x[key]) || 0), 0);
    const byKind = {};
    for (const it of list) { const k = byKind[it.kind] || (byKind[it.kind] = { count: 0, size: 0 }); k.count += 1; k.size += it.size; }
    return {
      scope, root, installRootDetected: scope === 'local' ? Boolean(installDir) : true, generatedAt: new Date(now()).toISOString(), items: list, kept,
      summary: { count: list.length, size: sum(list, 'size'), files: sum(list, 'files'), selectedCount: list.filter(x => x.selected).length, selectedSize: sum(list.filter(x => x.selected), 'size'), keptSize: sum(kept, 'size'), keptFiles: sum(kept, 'files'), byKind },
    };
  }

  // İstemciye giden görünüm: tekil dosya yolları (paths) gönderilmez.
  function publicPlan(plan) { return { ...plan, items: plan.items.map(({ paths, ...rest }) => rest) }; }

  async function scan(scope, options = {}) {
    const plan = publicPlan(await buildPlan(scope, options));
    const state = await readState();
    return { ...plan, autoClean: scope === 'local' ? state.autoClean || null : null, lastCheckAt: state.lastCheckAt || null };
  }

  async function removeTarget(target, guard) {
    if (isProtected(target, guard)) return { removed: false, freed: 0, error: 'protected' };
    const st = await lstatSafe(target);
    if (!st) return { removed: false, freed: 0, error: 'missing' };
    const freed = st.isDirectory() ? (await walkStats(target)).bytes : st.size;
    await fsp.rm(target, { recursive: true, force: true, maxRetries: 2 });
    return { removed: true, freed };
  }

  async function apply(scope, ids, options = {}) {
    assertScope(scope, options);
    const wanted = new Set((Array.isArray(ids) ? ids : []).map(String));
    if (!wanted.size) throw cleanupError('No items selected.', 'CLEANUP_EMPTY_SELECTION', 400);
    if (syncSettings) {
      const s = await syncSettings.read().catch(() => null);
      if (s && s.progress) throw cleanupError('Shared Sync is active. Try again after the transfer finishes.', 'SYNC_ACTIVE_BLOCKS_CLEANUP');
    }
    const plan = await buildPlan(scope, options);
    const guard = await protectedPaths();
    let removed = 0, freed = 0, failed = 0;
    const results = [];
    for (const item of plan.items) {
      if (!wanted.has(item.id)) continue;
      let ok = true, itemFreed = 0, error = '';
      for (const target of item.paths || [item.path]) {
        if (scope === 'sync' && !isInside(plan.root, target)) { ok = false; error = 'outside-root'; continue; }
        try {
          const r = await removeTarget(target, guard);
          if (r.removed) itemFreed += r.freed; else if (r.error !== 'missing') { ok = false; error = r.error; }
        } catch (e) { ok = false; error = e && e.code || 'delete-failed'; }
      }
      if (ok) removed += 1; else failed += 1;
      freed += itemFreed;
      results.push({ id: item.id, path: item.path, kind: item.kind, ok, freed: itemFreed, error });
    }
    const skipped = wanted.size - results.length;
    // Kullanıcı az önce temizlik yaptı: bekleyen hatırlatma bir sonraki haftalık kontrole kadar susar.
    if (!options.automatic && removed) await updateState(state => ({ ...state, [scope === 'sync' ? 'syncDismissedAt' : 'localDismissedAt']: new Date(now()).toISOString() }));
    return { scope, applied: true, removed, failed, skipped, freed, results, finishedAt: new Date(now()).toISOString() };
  }

  /* ---------------- haftalık kontrol ve hatırlatma ---------------- */

  const stateTarget = resolved(stateFile) || (roots.localDataRoot ? path.join(resolved(roots.localDataRoot), 'data-cleanup-state.json') : '');
  async function readState() {
    const value = stateTarget ? await readJsonSafe(stateTarget) : null;
    return value && value.schemaVersion === 1 ? value : { schemaVersion: 1 };
  }
  let stateQueue = Promise.resolve();
  function updateState(mutator) {
    const run = stateQueue.then(async () => {
      const next = { ...(await mutator(await readState())), schemaVersion: 1 };
      if (!stateTarget) return next;
      await fsp.mkdir(path.dirname(stateTarget), { recursive: true });
      const tmp = `${stateTarget}.${process.pid}.${Date.now()}.tmp`;
      await fsp.writeFile(tmp, JSON.stringify(next, null, 2), 'utf8');
      await fsp.rename(tmp, stateTarget);
      return next;
    });
    stateQueue = run.catch(() => {});
    return run;
  }
  function totals(items) {
    const picked = items.filter(item => item.selected);
    return { count: picked.length, size: picked.reduce((t, x) => t + x.size, 0) };
  }

  /*
   * Haftada bir çalışır (force ile hemen). Sırası:
   *   1) yerel planda Buyer Log'un kendi zararsız bayat verisini SORMADAN siler,
   *   2) kalan önerilen temizliği (yerel + yapılandırılmışsa sync) özetler.
   * Sync klasöründe otomatik silme yapılmaz; orası ortak alandır.
   */
  let running = null;
  async function weeklyCheck({ force = false } = {}) {
    if (running) return running;
    running = (async () => {
      const state = await readState();
      const last = Date.parse(state.lastCheckAt || '') || 0;
      if (!force && now() - last < WEEK_MS) return state;
      let autoClean = state.autoClean || null;
      try {
        const plan = await buildPlan('local');
        const ids = plan.items.filter(isAutoCleanable).map(item => item.id);
        if (ids.length) {
          const result = await apply('local', ids, { automatic: true });
          autoClean = { at: new Date(now()).toISOString(), removed: result.removed, freed: result.freed, failed: result.failed };
        }
      } catch (_) { /* senkron sürüyorsa ya da kilitliyse bir sonraki kontrole kalır */ }
      let local = null, sync = null;
      try { local = totals((await buildPlan('local')).items); } catch (_) {}
      try {
        const settings = syncSettings ? await syncSettings.read() : null;
        if (settings && settings.sharedSyncRoot) sync = totals((await buildPlan('sync', { moderator: true })).items);
      } catch (_) {}
      return updateState(current => ({ ...current, lastCheckAt: new Date(now()).toISOString(), autoClean, local, sync }));
    })();
    try { return await running; } finally { running = null; }
  }

  function dueFor(summary, dismissedAt, checkedAt) {
    if (!summary || summary.size < REMINDER_MIN_BYTES) return false;
    return !dismissedAt || Date.parse(dismissedAt) < Date.parse(checkedAt || 0);
  }
  async function reminder({ moderator = false } = {}) {
    const state = await readState();
    const local = state.local || null, sync = moderator ? state.sync || null : null;
    const localDue = dueFor(local, state.localDismissedAt, state.lastCheckAt);
    const syncDue = moderator && dueFor(sync, state.syncDismissedAt, state.lastCheckAt);
    return { due: localDue || syncDue, localDue, syncDue, local, sync, checkedAt: state.lastCheckAt || null, autoClean: state.autoClean || null, minBytes: REMINDER_MIN_BYTES };
  }
  async function dismissReminder({ moderator = false } = {}) {
    const at = new Date(now()).toISOString();
    await updateState(state => ({ ...state, localDismissedAt: at, ...(moderator ? { syncDismissedAt: at } : {}) }));
    return reminder({ moderator });
  }

  return { scan, apply, buildPlan, weeklyCheck, reminder, dismissReminder, resolveInstallRoot: () => installDir };
}

module.exports = { createDataCleanup, resolveInstallRoot, isInside, isAutoCleanable, AUTO_CLEAN_REASONS, REMINDER_MIN_BYTES, WEEK_MS, TEMP_FILE_RE, ARCHIVE_RE, INSTALLER_RE };

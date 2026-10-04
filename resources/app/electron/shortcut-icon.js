'use strict';
/*
 * WINDOWS KISAYOL SİMGESİ.
 * BuyerLog.exe'nin gömülü simgesi (Electron varsayılanı) app-core güncellemesiyle
 * değişemez; release yalnız resources/app içeriğini taşır. Pencere/görev çubuğu
 * simgesi BrowserWindow üzerinden buyerlog.ico'dan gelir. Masaüstü, Başlat menüsü
 * ve sabitlenmiş görev çubuğu kısayolları ise exe simgesini gösterdiği için,
 * BuyerLog.exe'yi hedefleyen mevcut kısayollar portable kökteki sabit bir
 * buyerlog.ico kopyasına yönlendirilir ve AppUserModelID ana süreçteki kimlikle
 * eşitlenir. Böylece Windows 10/11 görev çubuğu çalışan pencereyi yanlış/genel
 * bir dosya simgesi altında gruplamaz. Yeni kısayol oluşturulmaz, başka
 * uygulamanın kısayoluna dokunulmaz.
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const ICON_PREFIX = 'buyerlog-';

function samePath(a, b) {
  return path.resolve(String(a || '')).toLowerCase() === path.resolve(String(b || '')).toLowerCase();
}

/*
 * Sürüm klasörleri güncellemeyle değiştiği/budandığı için kısayol aktif app-core
 * içindeki dosyayı gösteremez. Dosya adı içerik özeti taşır: Windows simge
 * önbelleği aynı yol için eski görseli tutabildiğinden yeni simge yeni yol alır.
 */
function ensureStableIcon({ sourceIcon, iconDir }) {
  const bytes = fs.readFileSync(sourceIcon);
  const digest = crypto.createHash('sha256').update(bytes).digest('hex').slice(0, 12);
  const target = path.join(iconDir, ICON_PREFIX + digest + '.ico');
  fs.mkdirSync(iconDir, { recursive: true });
  if (!fs.existsSync(target)) {
    const temp = target + '.tmp';
    fs.writeFileSync(temp, bytes);
    fs.renameSync(temp, target);
  }
  return target;
}

function isOwnIcon(iconPath, iconDir) {
  if (!iconPath) return false;
  return samePath(path.dirname(String(iconPath)), iconDir) && path.basename(String(iconPath)).toLowerCase().startsWith(ICON_PREFIX);
}

function listShortcuts(dir, depth) {
  const found = [];
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return found; }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isFile() && /\.lnk$/i.test(entry.name)) found.push(full);
    else if (entry.isDirectory() && depth > 0) found.push(...listShortcuts(full, depth - 1));
  }
  return found;
}

function shortcutDirs(getPath) {
  const dirs = [];
  const add = (dir, depth) => { if (dir) dirs.push({ dir, depth }); };
  try { add(getPath('desktop'), 0); } catch (_) {}
  let appData = '';
  try { appData = getPath('appData'); } catch (_) {}
  if (appData) {
    add(path.join(appData, 'Microsoft', 'Windows', 'Start Menu', 'Programs'), 1);
    // Görev çubuğunda sabitlenmiş ve Windows'un kendiliğinden ürettiği
    // (ImplicitAppShortcuts\<id>\*.lnk) kısayollar.
    add(path.join(appData, 'Microsoft', 'Internet Explorer', 'Quick Launch', 'User Pinned'), 2);
  }
  return dirs;
}

function syncShortcutIcons({ shell, getPath, exePath, sourceIcon, iconDir, appUserModelId = '', log = () => {} }) {
  const result = { icon: '', updated: [], skipped: 0 };
  if (!shell || typeof shell.readShortcutLink !== 'function' || typeof shell.writeShortcutLink !== 'function') return result;
  if (!exePath || !sourceIcon || !fs.existsSync(sourceIcon)) return result;
  const icon = ensureStableIcon({ sourceIcon, iconDir });
  result.icon = icon;
  // Güncellenemeyen kısayolların hâlâ gösterdiği eski kopyalar silinmez.
  const referenced = new Set();
  for (const { dir, depth } of shortcutDirs(getPath)) {
    for (const file of listShortcuts(dir, depth)) {
      let link;
      try { link = shell.readShortcutLink(file); } catch (_) { continue; }
      if (!link) continue;
      // Hedefi farklı bir BuyerLog.exe olsa da (eski konum/başlatıcı) bizim
      // simge kopyamızı gösteren kısayol da güncellenir; aksi halde aşağıdaki
      // temizlik o kopyayı silince kısayol genel "dosya" simgesine düşer.
      const ownsIcon = isOwnIcon(link.icon, iconDir);
      if (!samePath(link.target, exePath) && !ownsIcon) continue;
      const iconMatches = Boolean(link.icon && samePath(link.icon, icon));
      const appIdMatches = !appUserModelId || String(link.appUserModelId || '').trim().toLowerCase() === String(appUserModelId).trim().toLowerCase();
      if (iconMatches && appIdMatches) { result.skipped += 1; continue; }
      try {
        const patch = { icon, iconIndex: 0 };
        if (appUserModelId) patch.appUserModelId = appUserModelId;
        if (shell.writeShortcutLink(file, 'update', patch)) result.updated.push(file);
        else if (ownsIcon) referenced.add(path.resolve(link.icon).toLowerCase());
      } catch (error) {
        if (ownsIcon) referenced.add(path.resolve(link.icon).toLowerCase());
        log('Kısayol simgesi güncellenemedi: ' + file + ' · ' + error.message);
      }
    }
  }
  // Artık hiçbir kısayolun göstermediği eski simge kopyaları temizlenir.
  try {
    for (const name of fs.readdirSync(iconDir)) {
      const full = path.join(iconDir, name);
      if (name.startsWith(ICON_PREFIX) && /\.ico$/i.test(name) && !samePath(full, icon) && !referenced.has(path.resolve(full).toLowerCase())) fs.rmSync(full, { force: true });
    }
  } catch (_) {}
  return result;
}

/*
 * Explorer ve görev çubuğu simgeleri önbellekten gösterir; kısayol veya exe simgesi
 * değiştiğinde Windows'un kendi aracıyla simge önbelleği yenilenir (Windows 10+).
 */
function refreshShellIcons({ spawn = require('child_process').spawn, env = process.env } = {}) {
  const tool = path.join(env.SystemRoot || env.windir || 'C:\\Windows', 'System32', 'ie4uinit.exe');
  if (!fs.existsSync(tool)) return false;
  try {
    const child = spawn(tool, ['-show'], { detached: true, stdio: 'ignore', windowsHide: true });
    if (child && typeof child.on === 'function') child.on('error', () => {});
    if (child && typeof child.unref === 'function') child.unref();
    return true;
  } catch (_) {
    return false;
  }
}

module.exports = { syncShortcutIcons, ensureStableIcon, shortcutDirs, refreshShellIcons };

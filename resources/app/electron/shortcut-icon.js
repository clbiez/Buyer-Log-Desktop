'use strict';
/*
 * WINDOWS KISAYOL SİMGESİ.
 * BuyerLog.exe'nin gömülü simgesi (Electron varsayılanı) app-core güncellemesiyle
 * değişemez; release yalnız resources/app içeriğini taşır. Pencere/görev çubuğu
 * simgesi BrowserWindow üzerinden buyerlog.ico'dan gelir. Masaüstü, Başlat menüsü
 * ve sabitlenmiş görev çubuğu kısayolları ise exe simgesini gösterdiği için,
 * BuyerLog.exe'yi hedefleyen mevcut kısayollar portable kökteki sabit bir
 * buyerlog.ico kopyasına yönlendirilir. Yeni kısayol oluşturulmaz, başka
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
    add(path.join(appData, 'Microsoft', 'Internet Explorer', 'Quick Launch', 'User Pinned', 'TaskBar'), 0);
  }
  return dirs;
}

function syncShortcutIcons({ shell, getPath, exePath, sourceIcon, iconDir, log = () => {} }) {
  const result = { icon: '', updated: [], skipped: 0 };
  if (!shell || typeof shell.readShortcutLink !== 'function' || typeof shell.writeShortcutLink !== 'function') return result;
  if (!exePath || !sourceIcon || !fs.existsSync(sourceIcon)) return result;
  const icon = ensureStableIcon({ sourceIcon, iconDir });
  result.icon = icon;
  for (const { dir, depth } of shortcutDirs(getPath)) {
    for (const file of listShortcuts(dir, depth)) {
      let link;
      try { link = shell.readShortcutLink(file); } catch (_) { continue; }
      if (!link || !samePath(link.target, exePath)) continue;
      if (link.icon && samePath(link.icon, icon)) { result.skipped += 1; continue; }
      try {
        if (shell.writeShortcutLink(file, 'update', { icon, iconIndex: 0 })) result.updated.push(file);
      } catch (error) {
        log('Kısayol simgesi güncellenemedi: ' + file + ' · ' + error.message);
      }
    }
  }
  // Artık hiçbir kısayolun göstermediği eski simge kopyaları temizlenir.
  try {
    for (const name of fs.readdirSync(iconDir)) {
      const full = path.join(iconDir, name);
      if (name.startsWith(ICON_PREFIX) && /\.ico$/i.test(name) && !samePath(full, icon)) fs.rmSync(full, { force: true });
    }
  } catch (_) {}
  return result;
}

module.exports = { syncShortcutIcons, ensureStableIcon, shortcutDirs };

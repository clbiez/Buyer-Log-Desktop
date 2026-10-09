#!/usr/bin/env node
'use strict';
/* Kullanılmayan kod temizliği (2026-10-09) için geri yükleme aracı.
 *
 * Git gerektirmez. removed-functions.json içindeki fonksiyonları birebir
 * metinleriyle eski yerlerine, files/ altındaki dosyaları da asıl yollarına
 * geri koyar. Dosyalar o günden sonra değişmiş olsa da çalışır:
 *   1. Önce silinen parçanın hemen önündeki/arkasındaki orijinal metni arar
 *      ve parçayı tam eski yerine ekler.
 *   2. Bulamazsa parçayı dosyanın sonuna ekler. Bunlar üst düzey fonksiyon
 *      bildirimleri olduğu için (hoisting) dosya sonunda da aynı çalışır.
 * Aynı adlı fonksiyon dosyada zaten varsa ona dokunmaz.
 * Her değişen JS dosyası `node --check` ile doğrulanır; sözdizimi bozulursa
 * o dosya hiç yazılmaz.
 *
 * Kullanım (depo kökünden):
 *   node docs/cleanup-backups/2026-10-09-kullanilmayan-kod/restore.js --dry-run
 *   node docs/cleanup-backups/2026-10-09-kullanilmayan-kod/restore.js
 *   node docs/cleanup-backups/2026-10-09-kullanilmayan-kod/restore.js --only=exportCsv,cpRowsScoped
 *   node docs/cleanup-backups/2026-10-09-kullanilmayan-kod/restore.js --files-only
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const HERE = __dirname;
const REPO = path.resolve(HERE, '..', '..', '..');
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const filesOnly = args.includes('--files-only');
const onlyArg = args.find(arg => arg.startsWith('--only='));
const only = onlyArg ? new Set(onlyArg.slice('--only='.length).split(',').map(s => s.trim()).filter(Boolean)) : null;

const manifest = JSON.parse(fs.readFileSync(path.join(HERE, 'removed-functions.json'), 'utf8'));
const log = (...parts) => console.log(...parts);
let failures = 0;

function escapeRegExp(text) { return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
function definesFunction(source, name) {
  return new RegExp(`(^|\\n)[ \\t]*(async[ \\t]+)?function[ \\t]*\\*?[ \\t]*${escapeRegExp(name)}[ \\t]*\\(`).test(source);
}
function uniqueIndex(source, needle) {
  if (!needle) return -1;
  const first = source.indexOf(needle);
  if (first < 0 || source.indexOf(needle, first + 1) >= 0) return -1;
  return first;
}
function insertionPoint(source, entry) {
  for (const size of [240, 120, 60]) {
    const before = entry.anchorBefore.slice(-size);
    if (before.length >= Math.min(size, 40)) {
      const at = uniqueIndex(source, before);
      if (at >= 0) return { index: at + before.length, how: `önceki metin (${size})` };
    }
  }
  for (const size of [240, 120, 60]) {
    const after = entry.anchorAfter.slice(0, size);
    if (after.length >= Math.min(size, 40)) {
      const at = uniqueIndex(source, after);
      if (at >= 0) return { index: at, how: `sonraki metin (${size})` };
    }
  }
  return null;
}
function syntaxOk(file, source) {
  if (!/\.(c|m)?js$/.test(file)) return true;
  const temp = path.join(os.tmpdir(), `bl-restore-${process.pid}-${path.basename(file)}`);
  fs.writeFileSync(temp, source);
  try { return spawnSync(process.execPath, ['--check', temp], { encoding: 'utf8' }).status === 0; }
  finally { try { fs.unlinkSync(temp); } catch (_) { /* geçici dosya */ } }
}

// 1) Silinen dosyalar
const filesRoot = path.join(HERE, 'files');
function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(item => {
    const full = path.join(dir, item.name);
    return item.isDirectory() ? walk(full) : [full];
  });
}
if (!only && fs.existsSync(filesRoot)) {
  for (const backup of walk(filesRoot)) {
    const relative = path.relative(filesRoot, backup).replace(/\.bak$/, '');
    const target = path.join(REPO, relative);
    if (fs.existsSync(target)) { log(`= dosya zaten var, atlandı: ${relative}`); continue; }
    if (!dryRun) { fs.mkdirSync(path.dirname(target), { recursive: true }); fs.copyFileSync(backup, target); }
    log(`${dryRun ? '~' : '+'} dosya geri konuldu: ${relative}`);
  }
}

// 2) Silinen fonksiyonlar (dosya başına, orijinal sırayla; böylece komşu
//    fonksiyonlar birbirinin ankrajını yeniden oluşturur)
if (!filesOnly) {
  const byFile = new Map();
  for (const entry of manifest.entries) {
    if (only && !only.has(entry.name)) continue;
    if (!byFile.has(entry.file)) byFile.set(entry.file, []);
    byFile.get(entry.file).push(entry);
  }
  for (const [file, entries] of byFile) {
    const target = path.join(REPO, file);
    if (!fs.existsSync(target)) { log(`! dosya bulunamadı: ${file}`); failures += 1; continue; }
    const original = fs.readFileSync(target, 'utf8');
    let source = original;
    const appended = [];
    entries.sort((a, b) => a.originalLine - b.originalLine);
    for (const entry of entries) {
      if (definesFunction(source, entry.name)) { log(`= ${entry.name} zaten var, atlandı (${file})`); continue; }
      const point = insertionPoint(source, entry);
      if (point) {
        source = source.slice(0, point.index) + entry.removedText + source.slice(point.index);
        log(`${dryRun ? '~' : '+'} ${entry.name} eski yerine (${point.how}) → ${file}`);
      } else {
        appended.push(entry);
        log(`${dryRun ? '~' : '+'} ${entry.name} dosya sonuna → ${file}`);
      }
    }
    if (appended.length) {
      source = source.replace(/\s*$/, '\n') + '\n// --- 2026-10-09 temizliğinden geri yüklendi (restore.js) ---\n'
        + appended.map(entry => entry.removedText.replace(/\s*$/, '\n')).join('');
    }
    if (source === original) continue;
    if (!syntaxOk(file, source)) { log(`! sözdizimi doğrulanamadı, ${file} yazılmadı`); failures += 1; continue; }
    if (!dryRun) fs.writeFileSync(target, source);
  }
}

log(dryRun ? '\nDeneme modu: hiçbir dosya yazılmadı.' : '\nGeri yükleme tamamlandı. server/*.js değiştiyse Buyer Log yeniden başlatılmalı.');
if (failures) { log(`${failures} sorun var; yukarıdaki "!" satırlarına bakın.`); process.exitCode = 1; }

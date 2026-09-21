@echo off
setlocal EnableExtensions EnableDelayedExpansion
chcp 65001 >nul
title Buyer Log - Kullanici Kimligi Kurtarma

set "ROOT=%~dp0"
set "EXE=%ROOT%BuyerLog.exe"
if not exist "%EXE%" set "EXE=%ROOT%Buyer Log.exe"
set "TMPJS=%TEMP%\BuyerLog-User-Recovery-%RANDOM%-%RANDOM%.js"

echo.
echo ============================================================
echo  BUYER LOG - KULLANICI KIMLIGI KURTARMA
echo ============================================================
echo.

tasklist 2>nul | findstr /I /C:"BuyerLog.exe" /C:"Buyer Log.exe" >nul
if not errorlevel 1 (
  echo [DURDU] Buyer Log acik.
  echo Buyer Log'u tamamen kapatip bu dosyayi tekrar calistirin.
  pause
  exit /b 20
)

if not exist "%EXE%" (
  echo [HATA] BuyerLog.exe bulunamadi.
  echo Bu CMD dosyasini Buyer Log Desktop ana klasorune koyun.
  pause
  exit /b 21
)

for /f "tokens=1 delims=:" %%N in ('findstr /n /c:"//__BUYERLOG_RECOVERY_JS__" "%~f0"') do set "MARK=%%N"
if not defined MARK (
  echo [HATA] Kurtarma kodu bulunamadi.
  pause
  exit /b 22
)

more +%MARK% "%~f0" > "%TMPJS%"
set "ELECTRON_RUN_AS_NODE=1"
"%EXE%" "%TMPJS%" "%ROOT%"
set "RC=%ERRORLEVEL%"
del /q "%TMPJS%" >nul 2>&1

echo.
if "%RC%"=="0" (
  echo Islem tamamlandi.
) else (
  echo Islem hata kodu %RC% ile sonlandi.
)
pause
exit /b %RC%

//__BUYERLOG_RECOVERY_JS__
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

const ROOT = path.resolve(process.argv[2] || process.cwd());
const BACKUP = path.join(ROOT, 'data-BACKUP-20260921');
const TARGET = path.join(ROOT, 'data', 'app', 'auth', 'user-access.json');
const EVIDENCE = path.join(ROOT, 'data', 'migration-evidence', 'user-identity-recovery');
const REPORT = path.join(ROOT, 'BuyerLog-Kullanici-Kurtarma-Raporu.txt');

function clean(v){ return String(v == null ? '' : v).trim(); }
function key(v){ return clean(v).toLocaleLowerCase('tr-TR'); }
function profiles(store){
  return [store && store.moderator, ...(store && Array.isArray(store.users) ? store.users : [])].filter(Boolean);
}
function safeRead(file){
  try {
    const parsed = JSON.parse(fs.readFileSync(file,'utf8').replace(/^\uFEFF/,''));
    if (!parsed || typeof parsed !== 'object') return null;
    if (!parsed.moderator && !Array.isArray(parsed.users)) return null;
    return parsed;
  } catch (_) { return null; }
}
function quality(file){
  const parsed = safeRead(file);
  if (!parsed) return null;
  const ps = profiles(parsed);
  const credentialCount = ps.filter(p => clean(p.passwordHash || p.pinHash)).length;
  const enabledCredentialCount = ps.filter(p => p.enabled !== false && p.status !== 'DISABLED' && clean(p.passwordHash || p.pinHash)).length;
  const usernameCount = new Set(ps.map(p => key(p.username || p.displayName)).filter(Boolean)).size;
  let mtime = 0;
  try { mtime = fs.statSync(file).mtimeMs || 0; } catch (_) {}
  const updatedAt = Date.parse(parsed._updatedAt || '') || 0;
  return {
    file, parsed,
    enabledCredentialCount, credentialCount, usernameCount,
    userCount: ps.length,
    revision: Number(parsed._revision) || 0,
    timestamp: Math.max(mtime, updatedAt),
  };
}
function compare(a,b){
  for (const k of ['enabledCredentialCount','credentialCount','revision','usernameCount','userCount','timestamp']) {
    const d = Number(b && b[k] || 0) - Number(a && a[k] || 0);
    if (d) return d;
  }
  return 0;
}
function isBetter(a,b){ return compare(a,b) < 0; }

const found = new Set();
function add(file){
  if (!file) return;
  const resolved = path.resolve(file);
  try { if (fs.statSync(resolved).isFile()) found.add(resolved); } catch (_) {}
}
function walk(dir, depth=0){
  if (depth > 9) return;
  let entries = [];
  try { entries = fs.readdirSync(dir,{withFileTypes:true}); } catch (_) { return; }
  for (const e of entries) {
    const full = path.join(dir,e.name);
    if (e.isDirectory()) {
      if (['node_modules','Cache','Code Cache','GPUCache','Service Worker'].includes(e.name)) continue;
      walk(full,depth+1);
    } else if (e.isFile() && /^user-access\.json(?:\..+)?$/i.test(e.name)) add(full);
  }
}

walk(BACKUP);
walk(path.join(ROOT,'data'));
add(path.join(ROOT,'resources','app','server','data','user-access.json'));
add(path.join(ROOT,'resources','app','server','data','user-access.json.bak'));

const hostAppData = process.env.APPDATA || '';
if (hostAppData) {
  add(path.join(hostAppData,'Buyer Log','auth','user-access.json'));
  add(path.join(hostAppData,'Buyer Log','auth','user-access.json.bak'));
}

const candidates = [...found].map(quality).filter(Boolean).sort(compare);
const current = quality(TARGET);
const lines = [];
const log = s => { console.log(s); lines.push(s); };

log('============================================================');
log('BUYER LOG - KULLANICI KIMLIGI KURTARMA RAPORU');
log('Tarih: ' + new Date().toISOString());
log('Kok: ' + ROOT);
log('============================================================');
log('');

if (!candidates.length) {
  log('[HATA] Okunabilir user-access.json kopyasi bulunamadi.');
  log('Eski kullanici deposu data-BACKUP-20260921 icinde degil.');
  fs.writeFileSync(REPORT,lines.join('\r\n'),'utf8');
  process.exit(30);
}

log('Bulunan kullanici depolari: ' + candidates.length);
log('');

for (let i=0;i<candidates.length;i++) {
  const q=candidates[i];
  log('['+(i+1)+'] ' + q.file);
  log('    Aktif sifreli hesap : ' + q.enabledCredentialCount);
  log('    Sifreli hesap       : ' + q.credentialCount);
  log('    Kullanici sayisi    : ' + q.userCount);
  log('    Kullanici adi sayisi: ' + q.usernameCount);
  log('    Revision            : ' + q.revision);
  const ps=profiles(q.parsed);
  for (const p of ps.slice(0,100)) {
    log('      - ' + clean(p.username || p.displayName || p.id) +
      ' | ' + clean(p.role || p.systemRole || '-') +
      ' | ' + (p.enabled === false ? 'PASIF' : 'AKTIF') +
      ' | credential=' + (clean(p.passwordHash || p.pinHash) ? 'VAR' : 'YOK'));
  }
  if (ps.length>100) log('      ... +' + (ps.length-100) + ' kullanici');
  log('');
}

const best = candidates[0];
log('SECILEN EN GUCLU DEPO:');
log(best.file);
log('');

if (path.resolve(best.file).toLowerCase() === path.resolve(TARGET).toLowerCase()) {
  log('[BILGI] En guclu depo zaten aktif hedef.');
  log('Bu dosyanin kendisinde yalniz bir kullanici varsa eski kullanicilar bu data yedeginde bulunmuyor.');
  fs.mkdirSync(path.dirname(REPORT),{recursive:true});
  fs.writeFileSync(REPORT,lines.join('\r\n'),'utf8');
  process.exit(0);
}

if (current && !isBetter(best,current)) {
  log('[BILGI] Mevcut aktif depo bulunan adaylardan daha zayif degil; otomatik degistirilmedi.');
  fs.writeFileSync(REPORT,lines.join('\r\n'),'utf8');
  process.exit(0);
}

fs.mkdirSync(path.dirname(TARGET),{recursive:true});
fs.mkdirSync(EVIDENCE,{recursive:true});
const stamp = new Date().toISOString().replace(/[:.]/g,'-');

if (fs.existsSync(TARGET)) {
  const before = path.join(EVIDENCE,'user-access-before-'+stamp+'.json');
  fs.copyFileSync(TARGET,before);
  log('[OK] Mevcut aktif depo yedeklendi: ' + before);
}

const selectedCopy = path.join(EVIDENCE,'selected-'+stamp+'-'+path.basename(best.file));
fs.copyFileSync(best.file,selectedCopy);
fs.copyFileSync(best.file,TARGET);

const sourceDir = path.dirname(best.file);
for (const name of ['user-audit.jsonl','iam-audit.json','user-access.meta.json']) {
  const source = path.join(sourceDir,name);
  if (!fs.existsSync(source)) continue;
  try { fs.copyFileSync(source,path.join(path.dirname(TARGET),name)); } catch (_) {}
}

const verify = quality(TARGET);
if (!verify || verify.userCount !== best.userCount || verify.credentialCount !== best.credentialCount) {
  log('[HATA] Etkinlestirilen kullanici deposu dogrulanamadi.');
  fs.writeFileSync(REPORT,lines.join('\r\n'),'utf8');
  process.exit(31);
}

log('');
log('[BASARILI] Eski kullanici deposu etkinlestirildi.');
log('Aktif hedef: ' + TARGET);
log('Kullanici sayisi: ' + verify.userCount);
log('Aktif sifreli hesap: ' + verify.enabledCredentialCount);
log('');
log('Simdi Buyer Logu acin. User Management ekraninda kullanicilari kontrol edin.');
log('Shared Hub olusturmayin; once bu listeyi dogrulayin.');

fs.writeFileSync(REPORT,lines.join('\r\n'),'utf8');
process.exit(0);

@echo off
setlocal EnableExtensions EnableDelayedExpansion
chcp 65001 >nul
title Buyer Log - Temiz Kaldirma

if /I "%~1"=="--worker" goto :WORKER

set "ROOT=%~dp0"
if "%ROOT:~-1%"=="\" set "ROOT=%ROOT:~0,-1%"
set "TMPSELF=%TEMP%\BuyerLog-Uninstall-%RANDOM%-%RANDOM%.cmd"

copy /y "%~f0" "%TMPSELF%" >nul 2>&1
if errorlevel 1 (
  echo [HATA] Uninstall araci gecici klasore kopyalanamadi.
  pause
  exit /b 10
)

start "Buyer Log - Temiz Kaldirma" cmd.exe /d /c call "%TMPSELF%" --worker "%ROOT%"
exit /b 0

:WORKER
set "ROOT=%~2"
if "%ROOT:~-1%"=="\" set "ROOT=%ROOT:~0,-1%"
set "EXE=%ROOT%\BuyerLog.exe"
if not exist "%EXE%" set "EXE=%ROOT%\Buyer Log.exe"
set "VERIFYJS=%TEMP%\BuyerLog-Uninstall-Verify-%RANDOM%-%RANDOM%.js"
set "VERIFYOUT=%TEMP%\BuyerLog-Uninstall-Verify-%RANDOM%-%RANDOM%.txt"
set "REPORT=%USERPROFILE%\Documents\BuyerLog-Uninstall-Dogrulama-%DATE:~-4%%DATE:~3,2%%DATE:~0,2%-%TIME:~0,2%%TIME:~3,2%%TIME:~6,2%.txt"
set "REPORT=%REPORT: =0%"

echo.
echo ============================================================
echo  BUYER LOG - TEMIZ KALDIRMA
echo ============================================================
echo.
echo Uygulama:
echo   %ROOT%
echo.
echo Bu arac ONCE Shared Hub kurtarma verilerini dogrular.
echo Dogrulama gecmezse HICBIR SEY SILINMEZ.
echo Ortak ag klasoru ASLA SILINMEZ.
echo.

tasklist 2>nul | findstr /I /C:"BuyerLog.exe" /C:"Buyer Log.exe" >nul
if not errorlevel 1 (
  echo [DURDU] Buyer Log halen acik.
  echo Uygulamayi tamamen kapatip bu araci yeniden calistirin.
  pause
  exit /b 20
)

if not exist "%EXE%" (
  echo [HATA] BuyerLog.exe bulunamadi.
  echo Bu CMD dosyasini Buyer Log Desktop ana klasorune koyup calistirin.
  pause
  exit /b 21
)

for /f "tokens=1 delims=:" %%N in ('findstr /n /c:"//__BUYERLOG_UNINSTALL_VERIFY_JS__" "%~f0"') do set "MARK=%%N"
if not defined MARK (
  echo [HATA] Dahili dogrulama kodu bulunamadi.
  pause
  exit /b 22
)

more +%MARK% "%~f0" > "%VERIFYJS%"
set "ELECTRON_RUN_AS_NODE=1"
"%EXE%" "%VERIFYJS%" "%ROOT%" "%VERIFYOUT%"
set "VERIFYRC=%ERRORLEVEL%"
del /q "%VERIFYJS%" >nul 2>&1

if exist "%VERIFYOUT%" (
  type "%VERIFYOUT%"
  copy /y "%VERIFYOUT%" "%REPORT%" >nul 2>&1
  del /q "%VERIFYOUT%" >nul 2>&1
)

if not "%VERIFYRC%"=="0" (
  echo.
  echo ============================================================
  echo  KALDIRMA IPTAL EDILDI
  echo ============================================================
  echo Shared Hub dogrulamasi basarisiz oldugu icin hicbir yerel veri silinmedi.
  echo Rapor:
  echo   %REPORT%
  echo.
  pause
  exit /b %VERIFYRC%
)

echo.
echo ============================================================
echo  DOGURLAMA BASARILI
echo ============================================================
echo Ortak ag klasorundeki IAM, Master, Business ve tum aktif
echo kullanicilarin kisisel yedekleri dogrulandi.
echo Yerel bekleyen sync degisikligi yok.
echo.
echo RAPOR:
echo   %REPORT%
echo.
echo DIKKAT: Bir sonraki adim bu bilgisayardaki Buyer Log'u ve
echo kullanici profilindeki Buyer Log klasorlerini KALICI olarak siler.
echo Shared Hub'a dokunulmaz.
echo.
set "CONFIRM="
set /p "CONFIRM=Devam etmek icin BUYERLOG-SIL yazin: "
if /I not "%CONFIRM%"=="BUYERLOG-SIL" (
  echo.
  echo Iptal edildi. Hicbir veri silinmedi.
  pause
  exit /b 0
)

echo.
echo [1/5] Kullanici seviyesi eski Buyer Log klasorleri temizleniyor...
call :RMDIR_SAFE "%APPDATA%\Buyer Log"
call :RMDIR_SAFE "%APPDATA%\BuyerLog"
call :RMDIR_SAFE "%APPDATA%\buyer-log-desktop"
call :RMDIR_SAFE "%LOCALAPPDATA%\BuyerLog"
call :RMDIR_SAFE "%LOCALAPPDATA%\Buyer Log"
call :RMDIR_SAFE "%LOCALAPPDATA%\buyer-log-desktop"
call :RMDIR_SAFE "%LOCALAPPDATA%\Programs\Buyer Log"
call :RMDIR_SAFE "%LOCALAPPDATA%\Programs\BuyerLog"

echo [2/5] Kullanici kisayollari temizleniyor...
del /q "%USERPROFILE%\Desktop\Buyer Log*.lnk" >nul 2>&1
del /q "%USERPROFILE%\Desktop\BuyerLog*.lnk" >nul 2>&1
del /q "%APPDATA%\Microsoft\Windows\Start Menu\Programs\Buyer Log*.lnk" >nul 2>&1
del /q "%APPDATA%\Microsoft\Windows\Start Menu\Programs\BuyerLog*.lnk" >nul 2>&1
rmdir /s /q "%APPDATA%\Microsoft\Windows\Start Menu\Programs\Buyer Log" >nul 2>&1
rmdir /s /q "%APPDATA%\Microsoft\Windows\Start Menu\Programs\BuyerLog" >nul 2>&1

echo [3/5] Kullanici seviyesi Buyer Log registry izleri temizleniyor...
reg delete "HKCU\Software\Microsoft\Windows\CurrentVersion\Run" /v "Buyer Log" /f >nul 2>&1
reg delete "HKCU\Software\Microsoft\Windows\CurrentVersion\Run" /v "BuyerLog" /f >nul 2>&1
reg delete "HKCU\Software\Buyer Log" /f >nul 2>&1
reg delete "HKCU\Software\BuyerLog" /f >nul 2>&1

echo [4/5] Portable Buyer Log klasoru temizleniyor...
if exist "%ROOT%\resources\app\package.json" (
  rmdir /s /q "%ROOT%" >nul 2>&1
) else (
  echo [HATA] Guvenlik kontrolu: uygulama kokunde package.json yok. Portable klasor silinmedi.
  pause
  exit /b 50
)

if exist "%ROOT%\" (
  echo [HATA] Buyer Log klasorunun bir kismi silinemedi.
  echo Acik dosya / kurumsal antivirus kilidi olabilir:
  echo   %ROOT%
  echo.
  echo Kalan klasoru Windows Explorer'dan kontrol edin.
  pause
  exit /b 51
)

echo [5/5] Tamamlandi.
echo.
echo ============================================================
echo  BUYER LOG BU BILGISAYARDAN TEMIZLENDI
echo ============================================================
echo.
echo Shared Hub KORUNDU.
echo Dogrulama raporu KORUNDU:
echo   %REPORT%
echo.
echo Artik yeni Buyer Log paketini BOS bir klasore acip temiz kurulum
echo yapabilirsiniz. Ilk kurulumda mevcut Shared Hub'i secin.
echo.
pause

start "" /b cmd.exe /d /c "ping 127.0.0.1 -n 2 >nul & del /q \"%~f0\"" >nul 2>&1
exit /b 0

:RMDIR_SAFE
set "DEL=%~1"
if "%DEL%"=="" goto :eof
if /I "%DEL%"=="%USERPROFILE%" goto :eof
if /I "%DEL%"=="%APPDATA%" goto :eof
if /I "%DEL%"=="%LOCALAPPDATA%" goto :eof
if exist "%DEL%\" rmdir /s /q "%DEL%" >nul 2>&1
goto :eof

//__BUYERLOG_UNINSTALL_VERIFY_JS__
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(process.argv[2] || '');
const OUT = path.resolve(process.argv[3] || path.join(process.env.TEMP || ROOT, 'BuyerLog-Uninstall-Verify.txt'));
const DATA = path.join(ROOT, 'data');
const LOCAL = path.join(DATA, 'local');
const AUTH = path.join(DATA, 'app', 'auth', 'user-access.json');
const DB = path.join(LOCAL, 'BuyerLogLocal.db');
const lines = [];
const errors = [];

function log(text) { lines.push(String(text)); }
function fail(text) { errors.push(String(text)); log('[HATA] ' + text); }
function ok(text) { log('[OK] ' + text); }
function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
}
function sha256File(file) {
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(file));
  return hash.digest('hex');
}
function countFiles(dir, predicate) {
  let count = 0;
  try {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) count += countFiles(full, predicate);
      else if (entry.isFile() && (!predicate || predicate(full))) count += 1;
    }
  } catch (_) {}
  return count;
}
function dangerousRoot(root) {
  const resolved = path.resolve(root);
  const home = path.resolve(process.env.USERPROFILE || process.env.HOME || '');
  const appData = path.resolve(process.env.APPDATA || path.join(resolved, '__none__'));
  const localAppData = path.resolve(process.env.LOCALAPPDATA || path.join(resolved, '__none__'));
  return resolved === path.parse(resolved).root || resolved === home || resolved === appData || resolved === localAppData;
}
function activeIamUsers(snapshot) {
  return (Array.isArray(snapshot && snapshot.users) ? snapshot.users : [])
    .filter(user => user && user.enabled !== false && String(user.status || 'ACTIVE').toUpperCase() === 'ACTIVE');
}
function safeUserId(user) {
  return String(user && (user.legacyId || user.id) || '').replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 100);
}

(async () => {
  log('============================================================');
  log('BUYER LOG - UNINSTALL ONCESI SHARED HUB DOGRULAMASI');
  log('Tarih: ' + new Date().toISOString());
  log('Uygulama: ' + ROOT);
  log('============================================================');
  log('');

  if (dangerousRoot(ROOT)) fail('Uygulama kok yolu guvenli degil; silme islemi engellendi.');
  const packageFile = path.join(ROOT, 'resources', 'app', 'package.json');
  if (!fs.existsSync(packageFile)) fail('Buyer Log package.json bulunamadi.');
  else {
    const pkg = readJson(packageFile);
    if (pkg.productName !== 'Buyer Log' && pkg.name !== 'buyer-log-desktop') fail('Secilen klasor Buyer Log Desktop olarak dogrulanamadi.');
    else ok('Buyer Log Desktop kimligi dogrulandi: ' + String(pkg.version || 'surum?'));
  }

  if (!fs.existsSync(DB)) fail('Yerel BuyerLogLocal.db bulunamadi.');
  if (!fs.existsSync(AUTH)) fail('Yerel kullanici kimlik deposu bulunamadi.');

  let localDb = null, syncSettings = null, sharedHub = null, sharedPolicy = null;
  try {
    const core = path.join(ROOT, 'resources', 'app', 'server', 'lib');
    const createLocalDb = require(path.join(core, 'local-db.js')).createLocalDb;
    const createSyncSettings = require(path.join(core, 'sync-settings.js')).createSyncSettings;
    const createSharedHub = require(path.join(core, 'shared-hub.js')).createSharedHub;
    sharedPolicy = require(path.join(core, 'shared-sync-policy.js'));
    localDb = createLocalDb(DB);
    await localDb.ensure();
    syncSettings = createSyncSettings({ localDataRoot: LOCAL, localDb });
    sharedHub = createSharedHub({ localDataRoot: LOCAL, appVersion: 'uninstall-verifier', networkTimeoutMs: 15000 });
  } catch (error) {
    fail('Buyer Log veri modulleri yuklenemedi: ' + error.message);
  }

  let settings = null, hub = null, hubRoot = '';
  if (syncSettings && sharedHub) {
    try {
      settings = await syncSettings.read();
      hubRoot = String(settings.sharedSyncRoot || settings.sharedSyncFolder || '').trim();
      if (!hubRoot) fail('Shared Hub yolu ayarlanmamis.');
      else {
        hub = await sharedHub.validate(hubRoot, { requireWrite: false });
        ok('Shared Hub dogrulandi: ' + hub.root);
        ok('Shared Hub ID: ' + hub.manifest.hubId);
      }
    } catch (error) {
      fail('Shared Hub erisimi/dogrulamasi basarisiz: ' + error.message);
    }
  }

  if (localDb) {
    try {
      const pending = await localDb.pendingCount();
      const unacked = typeof localDb.unacknowledgedCount === 'function' ? await localDb.unacknowledgedCount() : 0;
      if (pending > 0 || unacked > 0) fail('Yerel sync kuyrugu bos degil. pending=' + pending + ', unacknowledged=' + unacked + '. Buyer Log icinden Sync Now calistirin.');
      else ok('Yerel sync kuyrugu bos; bekleyen degisiklik yok.');
    } catch (error) {
      fail('Yerel sync kuyrugu okunamadi: ' + error.message);
    }
  }

  let master = null, business = null;
  if (hub && sharedHub) {
    try {
      master = await sharedHub.readMaster(hub.root, null);
      if (!master || !master.envelope || !master.envelope.payload) fail('Master checkpoint bulunamadi.');
      else {
        const records = master.envelope.payload.records || {};
        const settingsRecord = records['store:settings.json'];
        const overrides = records['store:overrides.json'];
        const fx = records['store:fx-rates.json'];
        const endeksKeys = Object.keys(records).filter(key => /^endeksmatik:/.test(key));
        if (!settingsRecord) fail('Master checkpoint: settings.json eksik.');
        else ok('Master checkpoint: sistem ayarlari mevcut.');
        if (!overrides) fail('Master checkpoint: overrides.json eksik.');
        else {
          const required = ['pricingRules','transitRules','nonDtrManufacturers','landedMultipliers','freightRates'];
          const missing = required.filter(key => !Object.prototype.hasOwnProperty.call(overrides, key));
          if (missing.length) fail('Master checkpoint: kritik is kurallari eksik: ' + missing.join(', '));
          else ok('Royalty, yol sureleri, DTR/Non-DTR, landed ve navlun ayarlari mevcut.');
        }
        if (!fx) fail('Master checkpoint: kur verisi (fx-rates) eksik.');
        else ok('Kur verisi Shared Hub Master icinde.');
        if (!endeksKeys.length) fail('Master checkpoint: Endeksmatik verisi bulunamadi.');
        else ok('Endeksmatik verisi mevcut (' + endeksKeys.length + ' kayit).');
        ok('Master revision: ' + master.head.revision);
      }
    } catch (error) {
      fail('Master checkpoint okunamadi: ' + error.message);
    }

    try {
      business = await sharedHub.readBusiness(hub.root, null);
      if (!business || !business.envelope || !business.envelope.payload) fail('Business checkpoint bulunamadi.');
      else {
        const records = business.envelope.payload.records || {};
        ok('Business checkpoint mevcut: revision ' + business.head.revision + ', kayit ' + Object.keys(records).length + '.');
      }
    } catch (error) {
      fail('Business checkpoint okunamadi: ' + error.message);
    }
  }

  let iamSnapshot = null;
  if (hub) {
    try {
      const iamRoot = path.join(hub.root, (hub.manifest.layout && hub.manifest.layout.iam) || 'iam', 'revisions');
      const revisions = fs.readdirSync(iamRoot).filter(name => /^\d{16}$/.test(name)).sort();
      if (!revisions.length) throw new Error('IAM revision yok.');
      const latest = revisions[revisions.length - 1];
      const dir = path.join(iamRoot, latest);
      const meta = readJson(path.join(dir, 'meta.json'));
      iamSnapshot = readJson(path.join(dir, 'snapshot.json'));
      const digest = crypto.createHash('sha256').update(JSON.stringify(iamSnapshot)).digest('hex');
      if (Number(meta.revision) !== Number(latest) || meta.sha256 !== digest) throw new Error('IAM hash/revision dogrulamasi basarisiz.');
      const users = activeIamUsers(iamSnapshot);
      if (!users.length) throw new Error('Aktif IAM kullanicisi bulunamadi.');
      ok('Central IAM dogrulandi: revision ' + meta.revision + ', aktif kullanici ' + users.length + '.');

      if (fs.existsSync(AUTH)) {
        const localAuth = readJson(AUTH);
        const localRev = Number(localAuth && localAuth._centralIam && localAuth._centralIam.iamRevision || 0);
        if (localRev && Number(meta.revision) < localRev) fail('Shared Hub IAM revision yerel IAM revisiondan eski. remote=' + meta.revision + ', local=' + localRev);
        else if (localRev) ok('Shared Hub IAM revision yerel cache ile uyumlu.');
      }
    } catch (error) {
      fail('Central IAM dogrulamasi basarisiz: ' + error.message);
    }
  }

  if (hub && iamSnapshot) {
    const personalRoot = path.join(hub.root, (hub.manifest.layout && hub.manifest.layout.personalBackups) || 'personal-backups');
    const missing = [];
    const bad = [];
    const users = activeIamUsers(iamSnapshot);
    for (const user of users) {
      const id = safeUserId(user);
      const label = String(user.username || user.displayName || user.legacyId || user.id || id);
      try {
        const latestFile = path.join(personalRoot, id, 'latest.json');
        const latest = readJson(latestFile);
        const zip = path.join(personalRoot, id, path.basename(String(latest.filename || '')));
        if (!latest.filename || !fs.existsSync(zip)) throw new Error('ZIP yok');
        const stat = fs.statSync(zip);
        if (!stat.isFile() || stat.size <= 0) throw new Error('ZIP bos');
        if (latest.sha256 && sha256File(zip) !== latest.sha256) throw new Error('ZIP SHA256 uyusmuyor');
      } catch (error) {
        missing.push(label);
        bad.push(label + ': ' + error.message);
      }
    }
    if (missing.length) {
      fail('Tum aktif kullanicilarin ortak kisisel yedegi hazir degil. Eksik/bozuk: ' + missing.slice(0, 30).join(', ') + (missing.length > 30 ? ' ... +' + (missing.length - 30) : ''));
      for (const item of bad.slice(0, 20)) log('  - ' + item);
    } else ok('Tum aktif kullanicilarin kisisel Shared Hub yedegi dogrulandi: ' + users.length + ' kullanici.');
  }

  if (hub) {
    try {
      const imagesRoot = path.join(hub.root, (hub.manifest.layout && hub.manifest.layout.images) || 'model-images');
      const localImages = countFiles(path.join(LOCAL, 'collection-images'), file => /\.(?:jpe?g|png|webp|gif)$/i.test(file));
      const sharedHeads = countFiles(path.join(imagesRoot, 'heads'), file => /\.json$/i.test(file));
      const sharedManifests = countFiles(path.join(imagesRoot, 'manifests'), file => /\.json$/i.test(file));
      if (localImages > 0 && sharedHeads === 0 && sharedManifests === 0) fail('Yerelde model/collection gorselleri var fakat Shared Hub model-images dagitim kaydi yok.');
      else ok('Model image dagitim deposu kontrol edildi. local=' + localImages + ', heads=' + sharedHeads + ', manifests=' + sharedManifests + '.');
    } catch (error) {
      fail('Model image dagitim deposu kontrol edilemedi: ' + error.message);
    }
  }

  if (settings) {
    const lastSync = Date.parse(settings.lastSync || '');
    if (!lastSync || Date.now() - lastSync > 60 * 60 * 1000) fail('Son basarili sync 60 dakikadan eski veya bilinmiyor. Buyer Log icinden Sync Now calistirin.');
    else ok('Son sync zamani guncel: ' + new Date(lastSync).toISOString());
    if (settings.lastError) fail('Sync ayarinda son hata kaydi var: ' + String(settings.lastError));
  }

  log('');
  if (errors.length) {
    log('SONUC: BASARISIZ - KALDIRMA ENGELLENDI');
    log('Hata sayisi: ' + errors.length);
  } else {
    log('SONUC: BASARILI - YEREL TEMIZ KALDIRMA ICIN GUVENLI');
    log('Shared Hub silinmeyecek; bu rapor yalniz kurtarma hazirligini onaylar.');
  }

  fs.writeFileSync(OUT, lines.join('\r\n') + '\r\n', 'utf8');
  process.exit(errors.length ? 40 : 0);
})().catch(error => {
  lines.push('[HATA] Beklenmeyen dogrulama hatasi: ' + (error && error.stack || error));
  lines.push('SONUC: BASARISIZ - KALDIRMA ENGELLENDI');
  try { fs.writeFileSync(OUT, lines.join('\r\n') + '\r\n', 'utf8'); } catch (_) {}
  process.exit(41);
});

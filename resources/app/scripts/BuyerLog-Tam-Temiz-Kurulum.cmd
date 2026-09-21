@echo off
setlocal EnableExtensions DisableDelayedExpansion
chcp 65001 >nul
title Buyer Log - Guvenli Tam Temizlik

rem ================================================================
rem BUYER LOG - PRE-WIPE SYNC + VERIFIED NETWORK BACKUP + DEEP CLEAN
rem ================================================================
rem Silme yalniz Shared Hub senkronu ve recovery backup dogrulanirsa baslar.
rem PowerShell kullanmaz. Yonetici hakki istemez.
rem ================================================================

set "ROOT=%~dp0"
if "%ROOT:~-1%"=="\" set "ROOT=%ROOT:~0,-1%"
set "EXE=%ROOT%\BuyerLog.exe"
if not exist "%EXE%" set "EXE=%ROOT%\Buyer Log.exe"
set "PREJS=%TEMP%\BuyerLog-PreWipe-%RANDOM%-%RANDOM%.js"
set "RESULT=%TEMP%\BuyerLog-PreWipe-Result-%RANDOM%-%RANDOM%.txt"
set "CLEANUP=%TEMP%\BuyerLog-Deep-Cleanup-%RANDOM%-%RANDOM%.cmd"

cls
echo ================================================================
echo  BUYER LOG - GUVENLI TAM TEMIZLIK
echo ================================================================
echo.
echo Once kritik veriler Shared Hub'a aktarilir ve geri okunarak dogrulanir.
echo Dogrulama gecmeden bu bilgisayardan HICBIR Buyer Log verisi silinmez.
echo.
echo Dogrulanan alanlar:
echo   Kullanici hesaplari / roller / yetkiler / parola hash'leri
echo   Collection ve CP ortak verisi
echo   Royalty / Hologram / License kurallari
echo   Yol sureleri, DTR/non-DTR, Landed ve Navlun ayarlari
echo   Kur (FX), Endeksmatik ve ortak sistem ayarlari
echo   Tum yerel data agaci icin dogrulanmis Full System Backup
echo.
echo Guvenlik: token, cookie, session ve cihaz-bagli Edge/Outlook oturumlari
echo ortak klasore kopyalanmaz. Temiz kurulumda yeniden giris gerekir.
echo.

if not exist "%EXE%" (
  echo [HATA] BuyerLog.exe bulunamadi.
  echo Bu CMD dosyasini Buyer Log Desktop ana klasorune koyun.
  pause
  exit /b 20
)

tasklist 2>nul | findstr /I /C:"BuyerLog.exe" /C:"Buyer Log.exe" >nul
if not errorlevel 1 (
  echo [DURDU] Buyer Log acik. Tamamen kapatip tekrar calistirin.
  pause
  exit /b 21
)

echo Kurulum kok dizini:
echo   %ROOT%
echo.
set "BL_PREWIPE_SHARED="
set /p "BL_PREWIPE_SHARED=Shared Hub klasoru (mevcut ayari kullanmak icin ENTER): "
set "BL_PREWIPE_ROOT=%ROOT%"
set "BL_PREWIPE_RESULT=%RESULT%"

for /f "tokens=1 delims=:" %%N in ('findstr /n /b /c:"//__BUYERLOG_PREWIPE_JS__" "%~f0"') do set "MARK=%%N"
if not defined MARK (
  echo [HATA] Dahili dogrulama kodu bulunamadi.
  pause
  exit /b 22
)
more +%MARK% "%~f0" > "%PREJS%"

set "ELECTRON_RUN_AS_NODE=1"
echo.
echo [1/2] Kritik veriler Shared Hub'a aktariliyor ve dogrulaniyor...
echo.
"%EXE%" "%PREJS%"
set "RC=%ERRORLEVEL%"
del /q "%PREJS%" >nul 2>&1

if not "%RC%"=="0" (
  echo.
  echo ================================================================
  echo  SILME IPTAL EDILDI
  echo ================================================================
  echo Kritik veri dogrulamasi gecmedi. Yerel Buyer Log verileri SILINMEDI.
  if exist "%RESULT%" type "%RESULT%"
  echo.
  pause
  exit /b %RC%
)

set "RECOVERY="
if exist "%RESULT%" set /p "RECOVERY="<"%RESULT%"
echo.
echo ================================================================
echo  AG SENKRONU VE RECOVERY YEDEGI DOGRULANDI
echo ================================================================
echo Recovery klasoru:
echo   %RECOVERY%
echo.
echo Simdi YALNIZ bu bilgisayardaki Buyer Log uygulama/data/cache/updater,
echo eski AppData kalintilari, eski kurulum klasorleri, kisayollar ve
echo ilgili HKCU kayitlari silinecek.
echo.
echo ORTAK AG KLASORUNE DOKUNULMAZ.
echo Kurumsal Edge/Chrome asil kullanici profilleri silinmez.
echo.
set "CONFIRM="
set /p "CONFIRM=Devam etmek icin tam olarak BUYER LOG SIL yazin: "
if /I not "%CONFIRM%"=="BUYER LOG SIL" (
  echo Silme iptal edildi. Ortak ag recovery yedegi korunuyor.
  pause
  exit /b 0
)

>"%CLEANUP%" echo @echo off
>>"%CLEANUP%" echo setlocal EnableExtensions DisableDelayedExpansion
>>"%CLEANUP%" echo chcp 65001 ^>nul
>>"%CLEANUP%" echo title Buyer Log - Derin Temizlik
>>"%CLEANUP%" echo set "BL_WIPE_ROOT=%ROOT%"
>>"%CLEANUP%" echo set "BL_RECOVERY=%RECOVERY%"
>>"%CLEANUP%" echo set "BL_CLEAN_LOG=%%BL_RECOVERY%%\CLEANUP-RESULT.txt"
>>"%CLEANUP%" echo echo BUYER LOG LOCAL CLEANUP ^> "%%BL_CLEAN_LOG%%"
>>"%CLEANUP%" echo echo Started: %%DATE%% %%TIME%% ^>^> "%%BL_CLEAN_LOG%%"
>>"%CLEANUP%" echo echo Computer: %%COMPUTERNAME%% ^>^> "%%BL_CLEAN_LOG%%"
>>"%CLEANUP%" echo ^>"%%BL_RECOVERY%%\WIPE-STARTED.txt" echo Started: %%DATE%% %%TIME%% on %%COMPUTERNAME%%
>>"%CLEANUP%" echo timeout /t 4 /nobreak ^>nul
>>"%CLEANUP%" echo taskkill /F /IM BuyerLog.exe ^>nul 2^>^&1
>>"%CLEANUP%" echo taskkill /F /IM "Buyer Log.exe" ^>nul 2^>^&1
>>"%CLEANUP%" echo call :RMDIR "%%BL_WIPE_ROOT%%" "Current installation root"
>>"%CLEANUP%" echo call :RMDIR "%%APPDATA%%\Buyer Log" "Roaming AppData Buyer Log"
>>"%CLEANUP%" echo call :RMDIR "%%APPDATA%%\BuyerLog" "Roaming AppData BuyerLog"
>>"%CLEANUP%" echo call :RMDIR "%%LOCALAPPDATA%%\BuyerLog" "Local AppData BuyerLog"
>>"%CLEANUP%" echo call :RMDIR "%%LOCALAPPDATA%%\Buyer Log" "Local AppData Buyer Log"
>>"%CLEANUP%" echo call :RMDIR "%%LOCALAPPDATA%%\Programs\Buyer Log" "Local Programs Buyer Log"
>>"%CLEANUP%" echo call :RMDIR "%%LOCALAPPDATA%%\Programs\BuyerLog" "Local Programs BuyerLog"
>>"%CLEANUP%" echo call :RMDIR "%%PROGRAMDATA%%\Buyer Log" "ProgramData Buyer Log"
>>"%CLEANUP%" echo call :RMDIR "%%PROGRAMDATA%%\BuyerLog" "ProgramData BuyerLog"
>>"%CLEANUP%" echo call :RMDIR "%%ProgramFiles%%\Buyer Log" "Program Files Buyer Log"
>>"%CLEANUP%" echo call :RMDIR "%%ProgramFiles%%\BuyerLog" "Program Files BuyerLog"
>>"%CLEANUP%" echo if defined ProgramFiles^(x86^) call :RMDIR "%%ProgramFiles(x86)%%\Buyer Log" "Program Files x86 Buyer Log"
>>"%CLEANUP%" echo if defined ProgramFiles^(x86^) call :RMDIR "%%ProgramFiles(x86)%%\BuyerLog" "Program Files x86 BuyerLog"
>>"%CLEANUP%" echo call :RMDIR "%%PROGRAMDATA%%\Microsoft\Windows\Start Menu\Programs\Buyer Log" "All Users Start Menu Buyer Log"
>>"%CLEANUP%" echo call :RMDIR "%%PROGRAMDATA%%\Microsoft\Windows\Start Menu\Programs\BuyerLog" "All Users Start Menu BuyerLog"
>>"%CLEANUP%" echo call :RMDIR "%%USERPROFILE%%\Desktop\Buyer Log" "Desktop legacy Buyer Log"
>>"%CLEANUP%" echo call :RMDIR "%%USERPROFILE%%\Desktop\BuyerLog" "Desktop legacy BuyerLog"
>>"%CLEANUP%" echo call :RMDIR "%%USERPROFILE%%\Desktop\Buyer Log Desktop" "Desktop Buyer Log Desktop"
>>"%CLEANUP%" echo call :RMDIR "%%USERPROFILE%%\Desktop\BuyerLog Desktop" "Desktop BuyerLog Desktop"
>>"%CLEANUP%" echo call :RMDIR "%%USERPROFILE%%\Documents\Buyer Log" "Documents legacy Buyer Log"
>>"%CLEANUP%" echo call :RMDIR "%%USERPROFILE%%\Documents\BuyerLog" "Documents legacy BuyerLog"
>>"%CLEANUP%" echo call :RMDIR "%%USERPROFILE%%\Documents\Buyer Log Desktop" "Documents Buyer Log Desktop"
>>"%CLEANUP%" echo call :RMDIR "%%USERPROFILE%%\Documents\BuyerLog Desktop" "Documents BuyerLog Desktop"
>>"%CLEANUP%" echo call :RMDIR "%%USERPROFILE%%\Downloads\Buyer Log" "Downloads legacy Buyer Log"
>>"%CLEANUP%" echo call :RMDIR "%%USERPROFILE%%\Downloads\BuyerLog" "Downloads legacy BuyerLog"
>>"%CLEANUP%" echo call :RMDIR "%%USERPROFILE%%\Downloads\Buyer Log Desktop" "Downloads Buyer Log Desktop"
>>"%CLEANUP%" echo call :RMDIR "%%USERPROFILE%%\Downloads\BuyerLog Desktop" "Downloads BuyerLog Desktop"
>>"%CLEANUP%" echo call :RMDIR "C:\Buyer Log" "C drive Buyer Log"
>>"%CLEANUP%" echo call :RMDIR "C:\BuyerLog" "C drive BuyerLog"
>>"%CLEANUP%" echo call :RMDIR "%%APPDATA%%\Microsoft\Windows\Start Menu\Programs\Buyer Log" "User Start Menu Buyer Log"
>>"%CLEANUP%" echo call :RMDIR "%%APPDATA%%\Microsoft\Windows\Start Menu\Programs\BuyerLog" "User Start Menu BuyerLog"
>>"%CLEANUP%" echo call :DELFILE "%%USERPROFILE%%\Desktop\Buyer Log.lnk" "Desktop shortcut"
>>"%CLEANUP%" echo call :DELFILE "%%USERPROFILE%%\Desktop\BuyerLog.lnk" "Desktop shortcut"
>>"%CLEANUP%" echo reg delete "HKCU\Software\Buyer Log" /f ^>nul 2^>^&1
>>"%CLEANUP%" echo reg delete "HKCU\Software\BuyerLog" /f ^>nul 2^>^&1
>>"%CLEANUP%" echo reg delete "HKCU\Software\Microsoft\Windows\CurrentVersion\Uninstall\Buyer Log" /f ^>nul 2^>^&1
>>"%CLEANUP%" echo reg delete "HKCU\Software\Microsoft\Windows\CurrentVersion\Uninstall\BuyerLog" /f ^>nul 2^>^&1
>>"%CLEANUP%" echo for /d %%%%D in ^("%%TEMP%%\buyerlog-*" "%%TEMP%%\buyer-log-*"^) do if exist "%%%%~fD\" rd /s /q "%%%%~fD" ^>nul 2^>^&1
>>"%CLEANUP%" echo echo Completed: %%DATE%% %%TIME%% ^>^> "%%BL_CLEAN_LOG%%"
>>"%CLEANUP%" echo ^>"%%BL_RECOVERY%%\WIPE-COMPLETE.txt" echo Completed: %%DATE%% %%TIME%% on %%COMPUTERNAME%%
>>"%CLEANUP%" echo echo.
>>"%CLEANUP%" echo echo ================================================================
>>"%CLEANUP%" echo echo  BUYER LOG YEREL TEMIZLIK TAMAMLANDI
>>"%CLEANUP%" echo echo ================================================================
>>"%CLEANUP%" echo echo Ortak ag recovery klasoru KORUNDU:
>>"%CLEANUP%" echo echo   %%BL_RECOVERY%%
>>"%CLEANUP%" echo echo.
>>"%CLEANUP%" echo echo Yeni ve bos bir klasore temiz Buyer Log kurulumu yapin.
>>"%CLEANUP%" echo echo Ilk kurulumda ayni Shared Hub klasorunu secin.
>>"%CLEANUP%" echo echo.
>>"%CLEANUP%" echo pause
>>"%CLEANUP%" echo del /q "%%~f0" ^>nul 2^>^&1
>>"%CLEANUP%" echo exit /b 0
>>"%CLEANUP%" echo.
>>"%CLEANUP%" echo :RMDIR
>>"%CLEANUP%" echo if not exist "%%~1\" ^(echo [SKIP] %%~2 ^>^> "%%BL_CLEAN_LOG%%" ^& goto :eof^)
>>"%CLEANUP%" echo attrib -r -s -h "%%~1\*" /s /d ^>nul 2^>^&1
>>"%CLEANUP%" echo rd /s /q "%%~1" ^>nul 2^>^&1
>>"%CLEANUP%" echo if exist "%%~1\" ^(echo [WARN] Could not remove %%~2 - %%~1 ^>^> "%%BL_CLEAN_LOG%%"^) else ^(echo [OK] %%~2 ^>^> "%%BL_CLEAN_LOG%%"^)
>>"%CLEANUP%" echo goto :eof
>>"%CLEANUP%" echo.
>>"%CLEANUP%" echo :DELFILE
>>"%CLEANUP%" echo if not exist "%%~1" goto :eof
>>"%CLEANUP%" echo del /f /q "%%~1" ^>nul 2^>^&1
>>"%CLEANUP%" echo if exist "%%~1" ^(echo [WARN] Could not remove %%~2 - %%~1 ^>^> "%%BL_CLEAN_LOG%%"^) else ^(echo [OK] %%~2 ^>^> "%%BL_CLEAN_LOG%%"^)
>>"%CLEANUP%" echo goto :eof

echo.
echo [2/2] Yerel derin temizlik baslatiliyor...
start "Buyer Log Deep Cleanup" cmd.exe /d /c ""%CLEANUP%""
exit /b 0

//__BUYERLOG_PREWIPE_JS__
'use strict';

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

function fail(message, code, details) {
  const error = new Error(message); error.code = code || 'PREWIPE_FAILED'; error.details = details || null; return error;
}
function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '')); } catch (_) { return fallback == null ? null : fallback; }
}
function safeId(value) { return String(value || 'user').replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 100) || 'user'; }
function profiles(store) { return [store && store.moderator].concat(Array.isArray(store && store.users) ? store.users : []).filter(Boolean); }
function stable(value) {
  if (Array.isArray(value)) return '[' + value.map(stable).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map(function(k){ return JSON.stringify(k) + ':' + stable(value[k]); }).join(',') + '}';
  return JSON.stringify(value);
}
function same(a, b) { return stable(a) === stable(b); }
function stamp() { return new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z'); }
function inside(root, target) {
  const rel = path.relative(path.resolve(root), path.resolve(target));
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}
function findCore(root) {
  const pointer = readJson(path.join(root, 'data', 'local', 'updater', 'current.json'), null);
  const candidate = pointer && String(pointer.appCoreRoot || '').trim();
  if (candidate) {
    const resolved = path.resolve(candidate);
    if (inside(root, resolved) && fs.existsSync(path.join(resolved, 'server', 'server.js'))) return resolved;
  }
  const fallback = path.join(root, 'resources', 'app');
  if (fs.existsSync(path.join(fallback, 'server', 'server.js'))) return fallback;
  throw fail('Aktif Buyer Log uygulama cekirdegi bulunamadi.', 'APP_CORE_NOT_FOUND');
}
function sha256File(file) {
  return new Promise(function(resolve, reject) {
    const hash = crypto.createHash('sha256'), input = fs.createReadStream(file);
    input.on('data', function(chunk){ hash.update(chunk); });
    input.on('error', reject);
    input.on('end', function(){ resolve(hash.digest('hex')); });
  });
}
async function atomicCopy(source, target) {
  await fsp.mkdir(path.dirname(target), { recursive: true });
  const tmp = target + '.' + process.pid + '.' + Date.now() + '.tmp';
  try {
    await fsp.copyFile(source, tmp);
    const handle = await fsp.open(tmp, 'r+');
    try { await handle.sync(); } catch (_) {} finally { await handle.close(); }
    await fsp.rename(tmp, target);
  } finally { await fsp.rm(tmp, { force: true }).catch(function(){}); }
}
async function atomicJson(file, value) {
  await fsp.mkdir(path.dirname(file), { recursive: true });
  const tmp = file + '.' + process.pid + '.' + Date.now() + '.tmp';
  try {
    const handle = await fsp.open(tmp, 'wx');
    try { await handle.writeFile(JSON.stringify(value, null, 2), 'utf8'); try { await handle.sync(); } catch (_) {} } finally { await handle.close(); }
    await fsp.rename(tmp, file);
  } finally { await fsp.rm(tmp, { force: true }).catch(function(){}); }
}
function countPersonalBackupUsers(root) {
  const base = path.join(root, 'personal-backups'); let count = 0;
  try {
    for (const entry of fs.readdirSync(base, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const latest = readJson(path.join(base, entry.name, 'latest.json'), null);
      if (latest && latest.filename && fs.existsSync(path.join(base, entry.name, path.basename(latest.filename)))) count++;
    }
  } catch (_) {}
  return count;
}
function localPersonalInventory(serverRoot, appRoot) {
  const result = {};
  for (const name of ['user-preferences','user-profiles','collection-workspaces','user-source-data']) {
    try { result['server/' + name] = fs.readdirSync(path.join(serverRoot, name)).length; } catch (_) { result['server/' + name] = 0; }
  }
  try { result['app/user-source-data'] = fs.readdirSync(path.join(appRoot, 'user-source-data')).length; } catch (_) { result['app/user-source-data'] = 0; }
  return result;
}

async function main() {
  const ROOT = path.resolve(String(process.env.BL_PREWIPE_ROOT || '').trim());
  const RESULT = String(process.env.BL_PREWIPE_RESULT || path.join(os.tmpdir(), 'BuyerLog-PreWipe-Result.txt'));
  if (!ROOT || !fs.existsSync(ROOT)) throw fail('Buyer Log kok klasoru bulunamadi.', 'ROOT_NOT_FOUND');
  const CORE = findCore(ROOT);
  const DATA = path.join(ROOT, 'data');
  const SERVER = path.join(DATA, 'server'), APP = path.join(DATA, 'app'), LOCAL = path.join(DATA, 'local');
  const LOCAL_DB = path.join(LOCAL, 'BuyerLogLocal.db'), AUTH = path.join(APP, 'auth'), CONFIG = path.join(ROOT, 'config.json');

  process.env.BUYER_LOG_PORTABLE_ROOT = ROOT;
  process.env.BUYER_LOG_PORTABLE_DATA_ROOT = DATA;
  process.env.BUYER_LOG_SERVER_DATA_ROOT = SERVER;
  process.env.BUYER_LOG_DATA_ROOT = APP;
  process.env.BUYER_LOG_LOCAL_DATA_ROOT = LOCAL;
  process.env.BUYER_LOG_LOCAL_DB = LOCAL_DB;
  process.env.BUYER_LOG_AUTH_DATA_ROOT = AUTH;
  process.env.BUYER_LOG_CONFIG_PATH = CONFIG;
  process.env.BL_DELTA_STORE_MODE = 'delta';

  const pkg = readJson(path.join(CORE, 'package.json'), {});
  const appVersion = String(pkg.version || 'unknown');
  const localDbLib = require(path.join(CORE, 'server', 'lib', 'local-db'));
  const syncLib = require(path.join(CORE, 'server', 'lib', 'sync-settings'));
  const hubLib = require(path.join(CORE, 'server', 'lib', 'shared-hub'));
  const policy = require(path.join(CORE, 'server', 'lib', 'shared-sync-policy'));
  const collectionReplication = require(path.join(CORE, 'server', 'lib', 'collection-replication'));
  const deltaLib = require(path.join(CORE, 'server', 'lib', 'delta-store'));
  const db = require(path.join(CORE, 'server', 'db'));
  const userAccess = require(path.join(CORE, 'server', 'lib', 'user-access'));
  const centralIam = require(path.join(CORE, 'server', 'lib', 'central-iam'));
  const workspaces = require(path.join(CORE, 'server', 'lib', 'collection-workspaces'));
  const cpStore = require(path.join(CORE, 'server', 'lib', 'cp-shared-store'));
  const plmLinks = require(path.join(CORE, 'server', 'lib', 'plm-style-links'));
  const emailGroups = require(path.join(CORE, 'server', 'lib', 'email-groups-store'));
  const quotations = require(path.join(CORE, 'server', 'lib', 'quotations-store'));
  const endeksmatik = require(path.join(CORE, 'server', 'lib', 'endeksmatik'));
  const backupLib = require(path.join(CORE, 'server', 'lib', 'backup-service'));
  const archiveLib = require(path.join(CORE, 'server', 'lib', 'backup-archive'));

  console.log('Version                : ' + appVersion);
  console.log('Local root             : ' + ROOT);

  const localDb = localDbLib.createLocalDb(LOCAL_DB);
  await localDb.ensure();
  function filter(direction) {
    return function(deltas) { return policy.filterDeltas(collectionReplication.filterCollectionWorkspaceDeltas(deltas), direction); };
  }
  const sync = syncLib.createSyncSettings({ localDataRoot: LOCAL, localDb: localDb, filterIncomingDeltas: filter('incoming'), filterOutgoingDeltas: filter('outgoing') });
  const hub = hubLib.createSharedHub({ localDataRoot: LOCAL, appVersion: appVersion, networkTimeoutMs: 20000 });
  const currentSync = await sync.read();
  const selected = String(process.env.BL_PREWIPE_SHARED || '').trim() || String(currentSync.sharedSyncRoot || currentSync.sharedSyncFolder || '').trim();
  if (!selected) throw fail('Shared Hub ayarli degil. CMDyi tekrar calistirip ortak klasor yolunu girin.', 'SHARED_HUB_REQUIRED');
  const sharedRoot = path.resolve(selected);
  if (!fs.existsSync(sharedRoot) || !fs.statSync(sharedRoot).isDirectory()) throw fail('Shared Hub klasoru bulunamadi: ' + sharedRoot, 'SHARED_HUB_UNAVAILABLE');

  let checked;
  try { checked = await hub.validate(sharedRoot, { requireWrite: true }); }
  catch (error) {
    if (error && error.code === 'SHARED_HUB_NOT_INITIALIZED') {
      console.log('Shared Hub             : bos klasor ilk kez baslatiliyor');
      checked = await hub.initialize(sharedRoot, { createdBy: 'prewipe-' + os.hostname(), allowNonEmpty: false });
    } else throw error;
  }
  await sync.save(checked.root, LOCAL_DB);
  console.log('Shared Hub             : ' + checked.root);
  console.log('Hub ID                 : ' + checked.manifest.hubId);

  const localStore = userAccess.loadStore();
  const users = profiles(localStore);
  const moderator = users.find(function(u){ return u && u.enabled !== false && (u.systemRole === 'moderator' || u.role === 'moderator'); });
  if (!users.length || !moderator) throw fail('Yerel kullanici deposu veya aktif moderator bulunamadi.', 'LOCAL_IAM_INVALID');
  const localBase = centralIam.baseline(localStore);
  const revisionsDir = path.join(checked.root, 'iam', 'revisions');
  let revisions = [];
  try { revisions = (await fsp.readdir(revisionsDir)).filter(function(n){ return /^\d{16}$/.test(n); }).sort(); } catch (_) {}
  if (!revisions.length) {
    console.log('Central IAM            : ilk yayin · ' + users.length + ' kullanici');
    const tempRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'buyerlog-prewipe-iam-'));
    try {
      const service = centralIam.createCentralIam({ sharedRoot: checked.root, cacheFile: path.join(tempRoot, 'user-access.json') });
      const source = JSON.parse(JSON.stringify(localStore)); delete source._centralIam;
      await service.initialize(source, moderator);
    } finally { await fsp.rm(tempRoot, { recursive: true, force: true }).catch(function(){}); }
    revisions = (await fsp.readdir(revisionsDir)).filter(function(n){ return /^\d{16}$/.test(n); }).sort();
  }
  const latestIam = revisions[revisions.length - 1];
  if (!latestIam) throw fail('Central IAM revision olusmadi.', 'IAM_NOT_INITIALIZED');
  const remoteSnapshot = readJson(path.join(revisionsDir, latestIam, 'snapshot.json'), null);
  centralIam.validateSnapshot(remoteSnapshot);
  const remoteStore = centralIam.storeFromSnapshot(remoteSnapshot, localStore);
  const remoteBase = centralIam.baseline(remoteStore);
  if (localBase.semanticSha256 !== remoteBase.semanticSha256 || remoteBase.passwordHashCount < localBase.passwordHashCount) {
    throw fail('Central IAM ile yerel kullanici deposu ayni degil. Veri kaybi riskine karsi silme durduruldu.', 'IAM_SEMANTIC_MISMATCH', { local: localBase, remote: remoteBase });
  }
  console.log('Central IAM            : OK · rev ' + remoteSnapshot.revision + ' · users ' + remoteBase.users + ' · credentials ' + remoteBase.passwordHashCount);

  const delta = deltaLib.createDeltaStore({ localDb: localDb, mode: 'delta' });
  db.attachDeltaStore(delta);
  plmLinks.attachDeltaStore(delta);
  emailGroups.attachDeltaStore(delta);
  quotations.attachDeltaStore(delta);
  workspaces.attachDeltaStore(delta);
  cpStore.attachDeltaStore(delta);
  endeksmatik.attachDeltaStore(delta);
  await delta.hydrate();

  const plm = plmLinks.loadPlmStyleLinks();
  if (plm && plm.links) await delta.seedOnce(plmLinks.COLLECTION, plm.links);
  const payload = db.deltaSeedPayload();
  try { if (fs.existsSync(emailGroups.FILE)) payload['email-groups.json'] = deltaLib.toDocumentRecord(emailGroups.loadStore()); } catch (_) {}
  try {
    const qfile = path.join(SERVER, 'quotations.json');
    if (fs.existsSync(qfile)) payload['quotations.json'] = deltaLib.toDocumentRecord(quotations.loadStore());
  } catch (_) {}
  const seeded = await delta.seedMissing(db.DELTA_STORE_COLLECTION, payload);
  if (seeded && seeded.error) throw seeded.error;
  const eSeed = await endeksmatik.seedMissing(delta); if (eSeed && eSeed.error) throw eSeed.error;
  await collectionReplication.quarantineLegacyCollectionDeltas({ localDb: localDb, workspaceFileForOwner: workspaces.workspaceFile });
  workspaces.ensureSharedWorkspace(users.map(function(u){ return u.id; }).filter(Boolean), moderator.id);
  const mirrored = await workspaces.mirrorWorkspace(workspaces.SHARED_COLLECTION_OWNER);
  if (mirrored && mirrored.ok === false) throw fail('Collection ortak alana aynalanamadi.', 'COLLECTION_MIRROR_FAILED');
  const cpSeed = await cpStore.seedFromOverrides(db.loadOverrides(), { actor: moderator });
  if (cpSeed && cpSeed.error) throw cpSeed.error;
  await delta.hydrate();

  let syncResult = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    syncResult = await sync.syncOnce();
    await delta.hydrate();
    const pending = await localDb.pendingCount();
    console.log('Sync tur ' + attempt + '            : pending=' + pending + ' · online=' + Boolean(syncResult && syncResult.online));
    if (pending === 0 && syncResult && syncResult.online) break;
    await new Promise(function(resolve){ setTimeout(resolve, 1200); });
  }
  const pending = await localDb.pendingCount();
  if (pending !== 0 || !syncResult || !syncResult.online) throw fail('Shared Hub sync tamamlanmadi. pending=' + pending, 'SYNC_NOT_CLEAN', syncResult);

  const state = await localDb.read();
  const masterRecords = policy.masterRecordsFromState(state);
  const businessRecords = policy.businessRecordsFromState(state);
  const mh0 = await hub.readMasterHead(checked.root), bh0 = await hub.readBusinessHead(checked.root);
  const mp = await hub.publishMaster(checked.root, { records: masterRecords }, { actorId: moderator.id, previousRevision: mh0 && mh0.revision || null });
  const bp = await hub.publishBusiness(checked.root, { records: businessRecords, syncCheckpoints: state.syncCheckpoints || {} }, { actorId: moderator.id, previousRevision: bh0 && bh0.revision || null });
  const mh = mp.head || await hub.readMasterHead(checked.root), bh = bp.head || await hub.readBusinessHead(checked.root);
  const mr = await hub.readMaster(checked.root, 0), br = await hub.readBusiness(checked.root, 0);
  const remoteMaster = mr && mr.envelope && mr.envelope.payload && mr.envelope.payload.records || {};
  const remoteBusiness = br && br.envelope && br.envelope.payload && br.envelope.payload.records || {};

  const localOverrides = db.loadOverrides();
  const remoteOverrides = remoteMaster['store:overrides.json'] || {};
  const fields = ['pricingRules','transitRules','nonDtrManufacturers','landedMultipliers','freightRates','antrepoMatchRule','antrepoMatchConfig','antrepoSourceMode','asasSourceMode','lflSourceMode','noteColumnDefs'];
  const coverage = {};
  for (const field of fields) {
    coverage[field] = same(localOverrides[field], remoteOverrides[field]);
    if (!coverage[field]) throw fail('Shared Master field uyusmuyor: ' + field, 'MASTER_FIELD_MISMATCH');
  }
  const localSettings = db.loadSettings();
  coverage.settings = Boolean(remoteMaster['store:settings.json']) || !Object.keys(localSettings || {}).filter(function(k){ return !k.startsWith('_'); }).length;
  if (!coverage.settings) throw fail('Shared Master settings eksik.', 'MASTER_SETTINGS_MISSING');
  const localFx = db.loadFx();
  const fxExpected = localFx && Object.keys(localFx).filter(function(k){ return !k.startsWith('_'); }).length > 0;
  coverage.fx = !fxExpected || Boolean(remoteMaster['store:fx-rates.json']);
  if (!coverage.fx) throw fail('Shared Master FX verisi eksik.', 'MASTER_FX_MISSING');
  let endExpected = false; try { endExpected = Boolean(endeksmatik.publicStatus().recordCount); } catch (_) {}
  coverage.endeksmatik = !endExpected || Object.keys(remoteMaster).some(function(id){ return /^endeksmatik:/.test(id); });
  if (!coverage.endeksmatik) throw fail('Shared Master Endeksmatik verisi eksik.', 'MASTER_ENDEKSMATIK_MISSING');
  const sharedCollection = workspaces.loadWorkspace(workspaces.SHARED_COLLECTION_OWNER);
  coverage.collection = !(sharedCollection && sharedCollection.rows && sharedCollection.rows.length) || Object.keys(remoteBusiness).some(function(id){ return /shared-collection/.test(id); });
  coverage.cp = !Object.keys(cpStore.readAllSync() || {}).length || Object.keys(remoteBusiness).some(function(id){ return /^cp-order:/.test(id); });
  if (!coverage.collection || !coverage.cp) throw fail('Shared Business Collection/CP dogrulamasi basarisiz.', 'BUSINESS_MISSING');
  console.log('Master / Business      : OK · master ' + mh.revision + ' · business ' + bh.revision);

  const recoveryRoot = path.join(checked.root, 'system-backups', 'prewipe', stamp() + '-' + safeId(os.hostname()));
  await fsp.mkdir(recoveryRoot, { recursive: true });
  const backupAccess = { backupSnapshot: function(){ return userAccess.backupSafeStore(localStore); } };
  const backupService = backupLib.createBackupService({ appVersion: appVersion, userAccess: backupAccess, syncSettings: sync, localDb: localDb });
  let archive = null, backupMeta;
  try {
    console.log('Full System Backup     : hazirlaniyor...');
    archive = await backupService.create({ mode: 'full', user: moderator, browserStorage: {} });
    const destination = path.join(recoveryRoot, archive.filename);
    await atomicCopy(archive.path, destination);
    const inspected = await archiveLib.inspectBackupArchive(destination, { requireType: 'full', validateData: true });
    const digest = await sha256File(destination), stat = await fsp.stat(destination);
    backupMeta = { filename: archive.filename, bytes: Number(stat.size), sha256: digest, fileCount: inspected.fileCount };
    console.log('Full System Backup     : OK · ' + Math.round(stat.size / 1048576) + ' MB');
  } finally { if (archive && typeof archive.cleanup === 'function') await archive.cleanup().catch(function(){}); }

  const iamCopy = path.join(recoveryRoot, 'iam-revision-' + latestIam);
  await fsp.mkdir(iamCopy, { recursive: true });
  for (const name of ['snapshot.json','meta.json','audit.json']) {
    const source = path.join(revisionsDir, latestIam, name);
    if (fs.existsSync(source)) await atomicCopy(source, path.join(iamCopy, name));
  }

  const personalBackupUsers = countPersonalBackupUsers(checked.root);
  if (personalBackupUsers < remoteBase.enabled) {
    console.warn('UYARI                  : Shared personal-backup bulunan kullanıcı=' + personalBackupUsers + ', aktif kullanıcı=' + remoteBase.enabled);
    console.warn('                         Full System Backup yerel server/app/local verisini korur; browser-only bl.user.* state yalnız 7.0.88+ personal backup ile taşınır.');
  }
  const report = {
    schemaVersion: 1, status: 'DELETE_READY', verifiedAt: new Date().toISOString(),
    computer: os.hostname(), appVersion: appVersion, localRoot: ROOT,
    sharedHub: { root: checked.root, hubId: checked.manifest.hubId },
    iam: { revision: remoteSnapshot.revision, users: remoteBase.users, enabled: remoteBase.enabled, admins: remoteBase.admins, passwordHashCount: remoteBase.passwordHashCount, semanticSha256: remoteBase.semanticSha256, matchesLocal: true },
    sync: { pendingLocalChanges: pending, online: true, lastSync: syncResult.lastSync || null },
    master: { revision: mh.revision, records: Object.keys(remoteMaster).length },
    business: { revision: bh.revision, records: Object.keys(remoteBusiness).length },
    criticalCoverage: {
      royaltyAndHologram: coverage.pricingRules,
      transitTimes: coverage.transitRules,
      nonDtrManufacturers: coverage.nonDtrManufacturers,
      landedMultipliers: coverage.landedMultipliers,
      freightRates: coverage.freightRates,
      fx: coverage.fx,
      endeksmatik: coverage.endeksmatik,
      settings: coverage.settings,
      collection: coverage.collection,
      cp: coverage.cp
    },
    fullSystemBackup: backupMeta,
    localPersonalDataInventory: localPersonalInventory(SERVER, APP),
    sharedPersonalBackupUsers: personalBackupUsers,
    personalBackupNote: 'Full System Backup bu bilgisayardaki server/app/local kullanici dosyalarini kapsar. Browser-only bl.user.* state yalniz kullanici Buyer Log 7.0.88+ ile personal-backups olusturduysa mevcuttur.',
    securityNote: 'Parola hashleri Central IAM ile korunur. Token/cookie/session ve cihaz-bagli browser credential ortak alana kopyalanmaz.'
  };
  await atomicJson(path.join(recoveryRoot, 'critical-state.json'), report);
  await atomicJson(path.join(recoveryRoot, 'DELETE-READY.json'), { status: 'DELETE_READY', verifiedAt: report.verifiedAt, computer: report.computer, hubId: checked.manifest.hubId, backupSha256: backupMeta.sha256, iamSemanticSha256: remoteBase.semanticSha256 });
  await fsp.writeFile(path.join(recoveryRoot, 'CLEAN-INSTALL.txt'),
    'BUYER LOG CLEAN INSTALL RECOVERY\r\n\r\n' +
    '1. Buyer Logu yeni ve bos bir yerel klasore kurun.\r\n' +
    '2. Ilk kurulumda AYNI Shared Hub klasorunu secin:\r\n' + checked.root + '\r\n' +
    '3. Central IAM kullanicilari; Shared Master/Business ortak veriyi geri getirir.\r\n' +
    '4. Bu klasordeki Full System Backup ikinci guvenlik katmanidir.\r\n' +
    '5. Browser/Outlook/API oturumlari cihaz-bagli oldugu icin yeniden giris yapin.\r\n',
    'utf8');
  await fsp.writeFile(RESULT, recoveryRoot + '\r\n', 'utf8');

  console.log('');
  console.log('===============================================================');
  console.log('DELETE-READY: kritik kontrollerin tamami gecti.');
  console.log('Recovery: ' + recoveryRoot);
  console.log('===============================================================');
}

main().then(function(){ process.exit(0); }).catch(async function(error) {
  console.error('');
  console.error('[PRE-WIPE HATA] ' + (error && error.message || error));
  if (error && error.code) console.error('Kod: ' + error.code);
  if (error && error.details) console.error('Detay: ' + JSON.stringify(error.details, null, 2));
  try {
    const output = String(process.env.BL_PREWIPE_RESULT || path.join(os.tmpdir(), 'BuyerLog-PreWipe-Result.txt'));
    await fsp.writeFile(output, 'SILME YAPILMADI\r\n' + String(error && error.code || 'PREWIPE_FAILED') + ': ' + String(error && error.message || error) + '\r\n', 'utf8');
  } catch (_) {}
  process.exit(40);
});

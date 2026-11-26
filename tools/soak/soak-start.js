'use strict';

/* BUYER LOG — YALITILMIŞ DAYANIKLILIK (SOAK) BAŞLATICISI
 *
 * Gerçek kurulumun ve gerçek Shared Hub'ın DIŞINDA, kendi veri klasörü ve kendi
 * OneDrive test klasörüyle bir Buyer Log sunucusu başlatır. Yeni bir dağıtım ya
 * da ikinci uygulama değildir: dalın `resources/app` kodunu, uygulamanın zaten
 * desteklediği veri kökü ortam değişkenleriyle çalıştırır (masaüstü başlatıcısı
 * bu değişkenleri kendi kurulum klasörüne zorladığı için doğrudan sunucu
 * çalıştırılır). Node gerekmez: kurulu BuyerLog.exe, ELECTRON_RUN_AS_NODE=1 ile
 * Node olarak kullanılabilir (bkz. soak-start.cmd).
 *
 * Güvenlik kontrolleri (biri tutmazsa sunucu BAŞLAMAZ):
 *  1. Soak kökü boş olmalı ya da bu başlatıcının bıraktığı işaret dosyasını taşımalı.
 *  2. Soak kökü gerçek Buyer Log veri klasörlerinin (%APPDATA%\Buyer Log,
 *     %LOCALAPPDATA%\BuyerLog) ya da bir kurulumun (BuyerLog.exe yanındaki data\) içinde olamaz.
 *  3. Hub klasörü ya boş olmalı (işaret dosyası yazılır) ya da işaret dosyasını
 *     taşımalı. İşaretsiz dolu klasör (ör. gerçek Shared Hub) reddedilir.
 *  4. Her başlatmada kayıtlı sync klasörü yeniden denetlenir: uygulama içinden
 *     gerçek Hub seçildiyse bir sonraki başlatma reddedilir.
 *
 * Kullanım:
 *   node tools/soak/soak-start.js --root C:\BuyerLogSoak\A --hub "C:\Users\<ad>\OneDrive\BuyerLogSoakHub" --machine A
 *   [--app <resources\app>] [--install <BuyerLog.exe klasörü>] [--port 6294] [--rows 2000]
 *   [--seed-rows 40] [--no-browser] [--check-only]
 *
 * Bağımlılıklar: GitHub kaynak ZIP'i node_modules taşımaz. Eksikse kurulu uygulamanın
 * çekirdeğinden (--install altındaki resources\app ya da .buyerlog-versions\<sürüm>\app)
 * kod klasörüne KOPYALANIR; kuruluma yazılmaz. Sabit sürümlü paketler sürüm eşitliğiyle denetlenir.
 */

const fs = require('fs');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const ROOT_MARKER = 'BUYERLOG-SOAK-ROOT.txt';
const HUB_MARKER = 'BUYERLOG-SOAK-HUB.txt';
const arg = (name, fallback = '') => { const i = process.argv.indexOf(name); return i < 0 ? fallback : String(process.argv[i + 1] || ''); };
const flag = name => process.argv.includes(name);
function fail(message) { console.error(`\n[SOAK] DURDURULDU / STOPPED: ${message}\n`); process.exit(2); }
const inside = (child, parent) => { const rel = path.relative(path.resolve(parent), path.resolve(child)); return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel)); };
const isEmptyDir = dir => !fs.existsSync(dir) || fs.readdirSync(dir).length === 0;

const root = arg('--root'), hub = arg('--hub'), machine = arg('--machine');
if (!root || !hub || !/^[A-Za-z0-9_-]{1,20}$/.test(machine)) fail('--root, --hub ve --machine (ör. A) zorunlu. / --root, --hub and --machine (e.g. A) are required.');
const app = path.resolve(arg('--app', path.join(__dirname, '..', '..', 'resources', 'app')));
const port = Number(arg('--port', '6294'));
const rows = Number(arg('--rows', '2000')), seedRows = Number(arg('--seed-rows', '40'));
if (!fs.existsSync(path.join(app, 'server', 'server.js'))) fail(`Uygulama kodu bulunamadı / app code not found: ${app}`);
for (let dir = app; ; dir = path.dirname(dir)) {
  if (fs.existsSync(path.join(dir, 'BuyerLog.exe'))) fail(`Test kodu bir Buyer Log kurulumunun içinde (${dir}). Dal ZIP'ini kurulumun dışında ayrı bir klasöre açın.`);
  if (path.dirname(dir) === dir) break;
}
if (!Number.isInteger(port) || port < 1024 || port > 65535 || port === 6194) fail('Port 1024–65535 arasında ve gerçek uygulamanın 6194 portundan farklı olmalı. / Port must differ from the real app (6194).');

// --- 1-2: soak kökü
const rootAbs = path.resolve(root);
const realDirs = [process.env.APPDATA && path.join(process.env.APPDATA, 'Buyer Log'), process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'BuyerLog'), process.env.BL_HOST_APPDATA && path.join(process.env.BL_HOST_APPDATA, 'Buyer Log')].filter(Boolean);
for (const real of realDirs) if (inside(rootAbs, real)) fail(`Soak kökü gerçek Buyer Log veri klasörünün içinde: ${real}`);
for (let dir = rootAbs; ; dir = path.dirname(dir)) {
  if (fs.existsSync(path.join(dir, 'BuyerLog.exe'))) fail(`Soak kökü bir Buyer Log kurulumunun içinde (${dir}). Kurulum klasörünün dışında ayrı bir klasör kullanın.`);
  if (path.dirname(dir) === dir) break;
}
if (!isEmptyDir(rootAbs) && !fs.existsSync(path.join(rootAbs, ROOT_MARKER))) fail(`Soak kökü boş değil ve işaret dosyası yok (${ROOT_MARKER}). Gerçek bir veri klasörü olabilir; boş bir klasör seçin.`);

// --- 3: hub klasörü
const hubAbs = path.resolve(hub);
if (!fs.existsSync(hubAbs)) fail(`Hub klasörü yok: ${hubAbs}. OneDrive içinde yalnız bu test için boş bir klasör oluşturun.`);
if (inside(hubAbs, rootAbs) || inside(rootAbs, hubAbs)) fail('Hub klasörü ile soak kökü iç içe olamaz.');
if (!fs.existsSync(path.join(hubAbs, HUB_MARKER))) {
  if (!isEmptyDir(hubAbs)) {
    const real = ['buyerlog-hub.json', 'BUYER_LOG_SYNC'].some(name => fs.existsSync(path.join(hubAbs, name)));
    fail(`Hub klasörü boş değil ve test işareti yok${real ? ' — GERÇEK bir Shared Hub gibi görünüyor' : ''}: ${hubAbs}`);
  }
  fs.writeFileSync(path.join(hubAbs, HUB_MARKER), `Buyer Log dayanıklılık testi Hub'ı. Gerçek veri koymayın. Created ${new Date().toISOString()} by ${machine}\n`);
}

// --- Klasör yapısı (masaüstü başlatıcısının portable düzeniyle aynı adlar)
const d = name => path.join(rootAbs, 'data', name);
const paths = { server: d('server'), app: d('app'), local: d('local'), auth: path.join(d('app'), 'auth'), tmp: path.join(rootAbs, 'tmp'), source: path.join(rootAbs, 'source'), appdata: d('portable-appdata'), localappdata: d('portable-localappdata') };
for (const dir of Object.values(paths)) fs.mkdirSync(dir, { recursive: true });
if (!fs.existsSync(path.join(rootAbs, ROOT_MARKER))) fs.writeFileSync(path.join(rootAbs, ROOT_MARKER), `Buyer Log dayanıklılık testi kökü (${machine}). Created ${new Date().toISOString()}\n`);

// --- 4: sync klasörü her başlatmada denetlenir
const syncFile = path.join(paths.local, 'sync-settings.json');
let sync = {};
try { sync = JSON.parse(fs.readFileSync(syncFile, 'utf8')); } catch (_) {}
if (sync.sharedSyncRoot && path.resolve(sync.sharedSyncRoot) !== hubAbs) {
  if (!fs.existsSync(path.join(sync.sharedSyncRoot, HUB_MARKER))) fail(`Kayıtlı sync klasörü test Hub'ı değil: ${sync.sharedSyncRoot}. (Uygulama içinden değiştirilmiş olabilir.)`);
}
fs.writeFileSync(syncFile, JSON.stringify({ ...sync, sharedSyncRoot: hubAbs }, null, 2));
const configFile = path.join(rootAbs, 'config.json');
let config = {};
try { config = JSON.parse(fs.readFileSync(configFile, 'utf8')); } catch (_) {}
fs.writeFileSync(configFile, JSON.stringify({ ...config, port, host: '127.0.0.1', sourceFolder: paths.source }, null, 2));

console.log(`[SOAK] Güvenlik kontrolleri geçti / checks passed · makine ${machine} · kök ${rootAbs} · hub ${hubAbs} · port ${port}`);
if (flag('--check-only')) process.exit(0);

// --- Çalışma zamanı bağımlılıkları: eksikse kurulu çekirdekten kod klasörüne kopyalanır (kuruluma yazılmaz)
const pkg = JSON.parse(fs.readFileSync(path.join(app, 'package.json'), 'utf8'));
const deps = Object.entries(pkg.dependencies || {});
const depVersion = (base, name) => { try { return JSON.parse(fs.readFileSync(path.join(base, 'node_modules', ...name.split('/'), 'package.json'), 'utf8')).version; } catch (_) { return null; } };
const depsProblem = base => deps.map(([name, spec]) => {
  const version = depVersion(base, name);
  if (!version) return `${name} yok`;
  return /^\d+\.\d+\.\d+$/.test(spec) && version !== spec ? `${name} ${version} ≠ ${spec}` : null;
}).filter(Boolean);
if (depsProblem(app).length) {
  const install = arg('--install');
  if (!install) fail(`Bağımlılıklar eksik (${depsProblem(app).join(', ')}). --install ile BuyerLog.exe klasörünü verin.`);
  const versionsDir = path.join(install, '.buyerlog-versions');
  const cores = [path.join(install, 'resources', 'app')];
  if (fs.existsSync(versionsDir)) for (const name of fs.readdirSync(versionsDir)) cores.unshift(path.join(versionsDir, name, 'app'));
  const usable = cores.filter(core => fs.existsSync(path.join(core, 'node_modules')))
    .sort((a, b) => fs.statSync(path.join(b, 'node_modules')).mtimeMs - fs.statSync(path.join(a, 'node_modules')).mtimeMs)
    .find(core => depsProblem(core).length === 0);
  if (!usable) fail(`Kurulumda uyumlu bağımlılık bulunamadı (${install}). Kurulu sürüm test dalından çok eskiyse güncelleyin. / No compatible node_modules in the install.`);
  console.log(`[SOAK] Bağımlılıklar kopyalanıyor (salt okuma kaynak) / copying dependencies from: ${usable}`);
  fs.cpSync(path.join(usable, 'node_modules'), path.join(app, 'node_modules'), { recursive: true });
  if (depsProblem(app).length) fail(`Bağımlılık kopyası eksik: ${depsProblem(app).join(', ')}`);
}

// --- Demo veri (her makinede aynı seed: aynı sentetik kaynak)
if (!fs.existsSync(path.join(paths.source, 'ASAS - Demo.xlsx'))) {
  console.log(`[SOAK] Demo veri üretiliyor (${rows} satır)…`);
  const generated = spawnSync(process.execPath, [path.join(app, 'scripts', 'generate-demo-data.js'), paths.source, '--rows', String(rows), '--seed', '7'], { cwd: app, encoding: 'utf8', env: { ...process.env } });
  if (generated.status !== 0) fail(`Demo veri üretilemedi: ${generated.stderr || generated.stdout}`);
}

// --- Sunucu: gerçek kullanıcı klasörleri ve TEMP de soak köküne yönlendirilir
const env = {
  ...process.env,
  APPDATA: paths.appdata, LOCALAPPDATA: paths.localappdata, TEMP: paths.tmp, TMP: paths.tmp, TMPDIR: paths.tmp,
  BUYER_LOG_SERVER_DATA_ROOT: paths.server, BUYER_LOG_DATA_ROOT: paths.app, BUYER_LOG_LOCAL_DATA_ROOT: paths.local,
  BUYER_LOG_LOCAL_DB: path.join(paths.local, 'BuyerLogLocal.db'), BUYER_LOG_AUTH_DATA_ROOT: paths.auth,
  BUYER_LOG_CONFIG_PATH: configFile, BUYER_LOG_PORTABLE_DATA_ROOT: path.join(rootAbs, 'data'), BUYER_LOG_TEMP_ROOT: paths.tmp,
  BL_DATA_DIR: paths.server, BL_KEEP_ALIVE: '1', BUYER_LOG_CENTRAL_IAM_ENABLED: '0', BUYER_LOG_SOAK_MACHINE: machine,
};
const logFile = path.join(rootAbs, 'server.log');
const log = fs.openSync(logFile, 'a');
const server = spawn(process.execPath, [path.join(app, 'server', 'server.js')], { cwd: app, env, stdio: ['ignore', log, log] });
const base = `http://127.0.0.1:${port}`;
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function api(pathname, options = {}, cookie = '') {
  const response = await fetch(base + pathname, { ...options, headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}), ...(options.headers || {}) } });
  return response;
}
(async () => {
  let up = false;
  for (let i = 0; i < 240 && server.exitCode === null; i++) { try { if ((await api('/api/status')).ok) { up = true; break; } } catch (_) {} await delay(500); }
  if (!up) fail(`Sunucu açılmadı; günlük: ${logFile}`);
  console.log(`[SOAK] Sunucu hazır / server ready: ${base}  (günlük / log: ${logFile})`);
  // İsteğe bağlı: ilk makinede test satırları (yalnız Koleksiyon boşsa).
  const password = arg('--seed-password');
  if (seedRows > 0 && password) {
    const login = await api('/api/user-login', { method: 'POST', body: JSON.stringify({ userId: 'moderator', password, newPassword: password }) });
    const cookie = String(login.headers.get('set-cookie') || '').split(';')[0];
    if (!login.ok) console.warn(`[SOAK] Giriş yapılamadı (${login.status}); test satırları eklenmedi.`);
    else {
      const current = await (await api('/api/collection-workspaces/moderator', {}, cookie)).json().catch(() => ({}));
      const existing = (current.workspace || current).rows || [];
      if (!existing.length) {
        const upserts = Array.from({ length: seedRows }, (_, i) => ({ id: i + 1, _rev: 0, plmId: `SOAK-${i + 1}`, modelKod: `SOAK-M${i + 1}`, colour: 'Ecru', not: '', buyer: '' }));
        const res = await api('/api/collection-workspaces/moderator', { method: 'PATCH', body: JSON.stringify({ upserts, deletes: [], nextId: seedRows + 1, expectedNewIds: upserts.map(row => String(row.id)) }) }, cookie);
        console.log(`[SOAK] ${seedRows} test satırı ${res.ok ? 'eklendi' : 'EKLENEMEDİ (' + res.status + ')'}.`);
      }
    }
  }
  if (!flag('--no-browser') && process.platform === 'win32') spawn('cmd', ['/c', 'start', '', base], { detached: true, stdio: 'ignore' }).unref();
  console.log('[SOAK] Durdurmak için bu pencerede Ctrl+C. / Press Ctrl+C to stop.');
})();
const stop = () => { try { server.kill(); } catch (_) {} process.exit(0); };
process.on('SIGINT', stop); process.on('SIGTERM', stop);
server.on('exit', code => { console.log(`[SOAK] Sunucu kapandı (kod ${code}).`); process.exit(code || 0); });

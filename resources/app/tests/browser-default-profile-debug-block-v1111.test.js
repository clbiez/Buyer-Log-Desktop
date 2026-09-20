'use strict';

/* CHROMIUM 136+ : GERÇEK PROFİLDE REMOTE DEBUGGING YASAK — v11.11
 *
 * ÖLÇÜLEN GERÇEK (Edge 153, bu makine):
 *   · Varsayılan kullanıcı veri klasörü + --remote-debugging-port
 *       → port DİNLEMEYE açılır, DevToolsActivePort yazılır,
 *         ama /json/version dahil TÜM HTTP uçları 404 döner ve
 *         tarayıcı WebSocket'i el sıkışmayı tamamlamaz.
 *   · AYRI bir --user-data-dir ile aynı sürüm
 *       → /json/version 200 döner, bağlantı sorunsuz kurulur.
 *
 * Yani "kullanıcının mevcut Edge profiline bağlan" stratejisi bu sürümlerde
 * çalışamaz; profil eşleştirme mantığı ne kadar doğru olursa olsun bağlantı
 * hiç kurulmaz ve PLM Sync sessizce ölür.
 *
 * Korunan regresyon: 136 ve üstü sürümlerde Buyer Log KENDİ kalıcı profiline
 * geçer; 136 altında mevcut profil davranışı AYNEN korunur.
 */

const test = require('node:test');
const winTest = process.platform === 'win32' ? test : test.skip;
const assert = require('node:assert/strict');
const path = require('node:path');

const service = require('../server/lib/browser-debug-service');

const EDGE_EXE = path.join('C:', 'Program Files (x86)', 'Microsoft', 'Edge', 'Application', 'msedge.exe');
const EDGE_APP_DIR = path.dirname(EDGE_EXE);
const EDGE_USER_DATA = path.join('C:', 'Users', 'test', 'AppData', 'Local', 'Microsoft', 'Edge', 'User Data');

/* Sürümü, kurulum klasöründeki sürüm adlı alt klasör belirler:
   `msedge.exe --version` Windows'ta bir GUI uygulaması olduğu için stdout'a
   çoğu zaman hiçbir şey yazmaz. */
function serviceWithEdgeVersion(versionFolder) {
  const localState = JSON.stringify({
    profile: {
      info_cache: { Default: { name: 'Gökberk' }, 'Profile 3': { name: 'Baska Kullanici' } },
      last_used: 'Default',
      profiles_order: ['Default', 'Profile 3'],
    },
  });
  const fakeFs = {
    existsSync: target => {
      const value = String(target);
      return value === EDGE_EXE || value === EDGE_USER_DATA
        || value === path.join(EDGE_USER_DATA, 'Local State')
        || value === path.join(EDGE_USER_DATA, 'Default')
        || value === path.join(EDGE_USER_DATA, 'Profile 3');
    },
    // `withFileTypes` ile çağrıldığında Dirent benzeri nesneler beklenir.
    readdirSync: (target, opts) => {
      const dirEntry = name => ({ name, isDirectory: () => true });
      if (String(target) === EDGE_APP_DIR) {
        return opts && opts.withFileTypes ? [dirEntry(versionFolder), dirEntry('SetupMetrics')] : [versionFolder, 'SetupMetrics'];
      }
      if (String(target) === EDGE_USER_DATA) {
        return opts && opts.withFileTypes
          ? [dirEntry('Default'), dirEntry('Profile 3')]
          : ['Default', 'Profile 3', 'Local State'];
      }
      return [];
    },
    readFileSync: target => {
      if (String(target) === path.join(EDGE_USER_DATA, 'Local State')) return localState;
      throw new Error('ENOENT');
    },
    statSync: () => ({ isDirectory: () => true }),
    mkdirSync: () => {},
  };
  return service.createBrowserDebugService({
    fs: fakeFs,
    // Sürüm stdout'tan OKUNAMAZ; gerçek Windows davranışı budur.
    spawnSync: () => ({ stdout: '', stderr: '' }),
    readRegistry: () => 'MSEdgeHTM',
    env: { PROGRAMFILES: path.join('C:', 'Program Files'), 'PROGRAMFILES(X86)': path.join('C:', 'Program Files (x86)'), LOCALAPPDATA: path.join('C:', 'Users', 'test', 'AppData', 'Local') },
    localDataRoot: path.join('C:', 'Users', 'test', 'AppData', 'Local', 'BuyerLog'),
    canonicalDataRoot: path.join('C:', 'Users', 'test', 'AppData', 'Local', 'BuyerLog'),
    configFile: path.join('C:', 'Users', 'test', 'AppData', 'Local', 'BuyerLog', 'settings', 'browser-debug-settings.json'),
    writeJson: () => {},
  });
}

winTest('sürüm, kurulum klasöründen okunur (--version stdout BOŞ olsa bile)', () => {
  const svc = serviceWithEdgeVersion('153.0.4234.32');
  const detected = svc.detectBrowser('edge');
  assert.equal(detected.installed, true);
  assert.equal(detected.majorVersion, 153);
});

winTest('Edge 136+ gerçek profile bağlanmayı DENEMEZ, kendi kalıcı profiline geçer', () => {
  const svc = serviceWithEdgeVersion('153.0.4234.32');
  const resolved = svc.resolveEffectiveBrowser();
  assert.equal(resolved.majorVersion, 153);
  assert.equal(resolved.defaultProfileDebuggingBlocked, true);
  assert.equal(resolved.profileMode, 'buyer-log-persistent');

  const strategy = svc.resolveProfileStrategy(resolved);
  assert.equal(strategy.mode, 'buyer-log-persistent', 'gerçek kullanıcı profili KULLANILMAMALI');
  assert.equal(strategy.persistentReason, 'default-profile-debugging-blocked');
  assert.ok(!strategy.userDataDir.includes('Microsoft'), `Buyer Log kendi klasörünü kullanmalı: ${strategy.userDataDir}`);
});

winTest('136 ALTINDA mevcut profil davranışı aynen korunur', () => {
  const svc = serviceWithEdgeVersion('120.0.2210.144');
  const resolved = svc.resolveEffectiveBrowser();
  assert.equal(resolved.majorVersion, 120);
  assert.equal(resolved.defaultProfileDebuggingBlocked, false);
  assert.equal(resolved.profileMode, 'existing');

  const strategy = svc.resolveProfileStrategy(resolved);
  assert.equal(strategy.mode, 'existing');
  assert.equal(strategy.userDataDir, EDGE_USER_DATA);
  assert.equal(strategy.persistentReason, undefined);
});

winTest('eşik tam 136\'dır', () => {
  assert.equal(serviceWithEdgeVersion('135.0.1.1').resolveEffectiveBrowser().defaultProfileDebuggingBlocked, false);
  assert.equal(serviceWithEdgeVersion('136.0.1.1').resolveEffectiveBrowser().defaultProfileDebuggingBlocked, true);
});

winTest('kalıcı profil modunda da --user-data-dir ve port zorunludur', () => {
  const svc = serviceWithEdgeVersion('153.0.4234.32');
  const strategy = svc.resolveProfileStrategy(svc.resolveEffectiveBrowser());
  const args = service.buildLaunchArgs({ browser: 'edge', profileMode: strategy.mode, userDataDir: strategy.userDataDir, profileDirectory: strategy.profileDirectory, port: 9223 });
  assert.ok(args.some(item => item.startsWith('--user-data-dir=')), '--user-data-dir olmadan singleton devri olur ve port hiç açılmaz');
  assert.ok(args.includes('--remote-debugging-port=9223'));
  assert.ok(args.includes('--remote-debugging-address=127.0.0.1'));
});

winTest('bağlanamayınca kullanıcıya NE YAPACAĞI söylenir, döngüde bırakılmaz', () => {
  const fs = require('node:fs');
  const source = fs.readFileSync(path.join(__dirname, '..', 'server', 'lib', 'agent-browser-connector.js'), 'utf8');
  assert.match(source, /BROWSER_DEFAULT_PROFILE_DEBUG_BLOCKED/);
  assert.match(source, /resolvedBrowser\.defaultProfileDebuggingBlocked/);
});

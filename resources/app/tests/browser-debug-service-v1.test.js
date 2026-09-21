'use strict';

const test = require('node:test');
const winTest = process.platform === 'win32' ? test : test.skip;
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');

const service = require('../server/lib/browser-debug-service');

winTest('browser preference defaults to system and explicit overrides are preserved', () => {
  assert.equal(service.normalizePreferredBrowser(), 'system');
  assert.equal(service.normalizePreferredBrowser('edge'), 'edge');
  assert.equal(service.normalizePreferredBrowser('chrome'), 'chrome');
  assert.equal(service.normalizePreferredBrowser('firefox'), 'system');
});

winTest('system default resolver maps HTTPS/HTTP UserChoice ProgIds without writing Windows state', () => {
  assert.equal(service.browserFromProgId('MSEdgeHTM'), 'edge');
  assert.equal(service.browserFromProgId('ChromeHTML'), 'chrome');
  assert.equal(service.browserFromProgId('FirefoxURL'), 'unsupported');
  const result = service.resolveSystemDefault({
    readRegistry: key => key.includes('https') ? 'ChromeHTML' : 'MSEdgeHTM',
  });
  assert.equal(result.browser, 'chrome');
  assert.equal(result.detectedProgId, 'ChromeHTML');
  assert.equal(result.source, 'windows-userchoice-https');
});

winTest('policy normalization treats explicit zero as an organization block', () => {
  assert.equal(service.normalizePolicyValue('0'), 'BLOCKED_BY_ORGANIZATION');
  assert.equal(service.normalizePolicyValue(1), 'ALLOWED');
  assert.equal(service.normalizePolicyValue(undefined), 'NOT_CONFIGURED');
  assert.equal(service.combinePolicyValues([undefined, '1']), 'ALLOWED');
  assert.equal(service.combinePolicyValues(['1', '0']), 'BLOCKED_BY_ORGANIZATION');
});

winTest('Chrome and Edge launch arguments are loopback-safe and profile validated', () => {
  const chrome = service.buildLaunchArgs({
    browser: 'chrome',
    profileMode: 'buyer-log-persistent',
    userDataDir: path.join('C:', 'Users', 'test', 'BuyerLog', 'browser-profiles', 'chrome'),
    profileDirectory: 'Default',
    port: 9237,
  });
  assert.deepEqual(chrome, [
    `--user-data-dir=${path.join('C:', 'Users', 'test', 'BuyerLog', 'browser-profiles', 'chrome')}`,
    '--profile-directory=Default',
    '--no-first-run',
    '--no-default-browser-check',
    '--remote-debugging-address=127.0.0.1',
    '--remote-debugging-port=9237',
  ]);
  assert.throws(() => service.buildLaunchArgs({ browser: 'chrome', profileDirectory: 'Default & whoami', port: 9237 }), /profile/i);
  assert.throws(() => service.buildLaunchArgs({ browser: 'chrome', profileMode: 'unexpected', profileDirectory: 'Default', port: 9237 }), /mode/i);
  assert.throws(() => service.buildLaunchArgs({ browser: 'edge', profileDirectory: 'Default', port: 80 }), /port/i);
});

winTest('Edge Local State profile metadata keeps friendly name separate from directory id', () => {
  const profiles = service.parseEdgeProfiles(JSON.stringify({ info_cache: {
    'Profile 1': { name: 'Work', user_name: 'buyer@example.com' },
    Default: { name: 'Personal' },
  }}), ['Default', 'Profile 1', 'System Profile']);
  assert.deepEqual(profiles, [
    { id: 'Default', name: 'Personal' },
    { id: 'Profile 1', name: 'Work', userName: 'buyer@example.com' },
  ]);
});

winTest('CDP version validator rejects foreign HTTP services and non-loopback endpoints', () => {
  assert.equal(service.validateCdpVersion({ Browser: 'Microsoft Edge/140', webSocketDebuggerUrl: 'ws://127.0.0.1:9237/devtools/browser/a' }, 9237).ok, true);
  assert.equal(service.validateCdpVersion({ server: 'nginx' }, 9237).ok, false);
  assert.equal(service.validateCdpVersion({ Browser: 'Chrome/140', webSocketDebuggerUrl: 'ws://192.168.1.5:9237/devtools/browser/a' }, 9237).ok, false);
});

winTest('configuration keeps browser runtime settings local and validates port', () => {
  const config = service.normalizeConfiguration({ preferredBrowser: 'chrome', selectedEdgeProfileDirectory: 'Profile 1', preferredPort: 9237, enabled: true });
  // deviceId: ayarın hangi makinede kurulduğunu söyleyen mühür (sır değildir).
  assert.deepEqual(config, { schemaVersion: 1, preferredBrowser: 'chrome', selectedEdgeProfileDirectory: 'Profile 1', preferredPort: 9237, enabled: true, deviceId: '' });
  assert.throws(() => service.normalizeConfiguration({ preferredBrowser: 'chrome', preferredPort: 1 }), /port/i);
});

winTest('CDP verifier only accepts a real loopback /json/version payload', async () => {
  const fake = service.createBrowserDebugService({
    localDataRoot: path.join('C:', 'Users', 'test', 'BuyerLog'),
    fetch: async () => ({ ok: true, text: async () => JSON.stringify({ Browser: 'Chrome/140', webSocketDebuggerUrl: 'ws://127.0.0.1:9237/devtools/browser/test' }) }),
  });
  const result = await fake.verifyEndpoint(9237);
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.endpoint, 'http://127.0.0.1:9237');
});

winTest('system preference re-resolves the effective browser while explicit preference wins', () => {
  const fake = service.createBrowserDebugService({
    env: { LOCALAPPDATA: 'C:\\Users\\test\\AppData\\Local', PROGRAMFILES: 'C:\\Program Files', 'PROGRAMFILES(X86)': '' },
    fs: { existsSync: item => item.endsWith('chrome.exe'), readFileSync: () => '', readdirSync: () => [] },
    readRegistry: () => 'ChromeHTML',
  });
  assert.equal(fake.resolveEffectiveBrowser({ preferredBrowser: 'system' }).resolvedBrowser, 'chrome');
  assert.equal(fake.resolveEffectiveBrowser({ preferredBrowser: 'edge' }).resolvedBrowser, 'edge');
});

winTest('portable host hand-off keeps browser profiles outside the redirected package data root', () => {
  const fake = service.createBrowserDebugService({
    env: { BL_HOST_LOCALAPPDATA: 'C:\\Users\\test\\AppData\\Local', LOCALAPPDATA: 'C:\\BuyerLogPortable\\local' },
  });
  assert.equal(fake.localDataRoot, path.resolve('C:\\Users\\test\\AppData\\Local\\BuyerLog'));
  assert.match(fake.resolveProfileStrategy({ resolvedBrowser: 'chrome' }).userDataDir, /AppData[\\/]Local[\\/]BuyerLog[\\/]browser-profiles[\\/]chrome/i);
});

winTest('explicit organization policy blocks launch before browser spawn', async () => {
  let spawned = false;
  const fake = service.createBrowserDebugService({
    localDataRoot: path.join('C:', 'Users', 'test', 'BuyerLog'),
    env: { LOCALAPPDATA: 'C:\\Users\\test\\AppData\\Local', PROGRAMFILES: 'C:\\Program Files', 'PROGRAMFILES(X86)': '' },
    fs: { existsSync: item => item.endsWith('msedge.exe'), readFileSync: () => '', mkdirSync: () => {} },
    writeJson: () => {}, spawnSync: () => ({ stdout: 'Microsoft Edge 140' }),
    spawn: () => { spawned = true; return { pid: 1, unref() {} }; },
    readRegistry: () => '0', fetch: async () => ({ ok: false, status: 404, text: async () => '{}' }),
    canBindPort: () => true,
  });
  const result = await fake.enableAndLaunch({ preferredBrowser: 'edge', preferredPort: 49878 });
  assert.equal(result.status, 'Blocked by organization');
  assert.equal(spawned, false);
});

winTest('a foreign service on the preferred port is rejected and an alternate loopback port is chosen', async () => {
  const fake = service.createBrowserDebugService({
    localDataRoot: path.join('C:', 'Users', 'test', 'BuyerLog'),
    fetch: async () => ({ ok: true, text: async () => JSON.stringify({ server: 'nginx' }) }),
    canBindPort: port => Number(port) !== 9222,
  });
  const result = await fake.resolveDebugPort('edge', 9222);
  assert.equal(result.port, 9223);
  assert.equal(result.existingEndpoint, null);
});

winTest('registry output, Edge profiles and policy sources are normalized without secret-store access', () => {
  assert.equal(service.parseRegistryValue('    ProgId    REG_SZ    ChromeHTML\r\n', 'ProgId'), 'ChromeHTML');
  assert.equal(service.parseRegistryValue('Name REG_SZ value', 'Missing'), '');
  assert.equal(service.normalizePolicyValue('managed'), 'UNKNOWN');
  const fake = service.createBrowserDebugService({
    localDataRoot: path.join('C:', 'Users', 'test', 'BuyerLog'),
    env: { LOCALAPPDATA: 'C:\\Users\\test\\AppData\\Local' },
    fs: {
      existsSync: item => item.endsWith('Local State'),
      readdirSync: () => [{ name: 'Default', isDirectory: () => true }, { name: 'Profile 2', isDirectory: () => true }, { name: 'Guest Profile', isDirectory: () => true }],
      readFileSync: () => JSON.stringify({ info_cache: { Default: { name: 'Work' }, 'Profile 2': { name: 'IAS' } } }),
    },
    readRegistry: key => key.includes('HKCU') ? '0' : '1',
  });
  assert.deepEqual(fake.listBrowserProfiles('edge'), [
    { id: 'Default', name: 'Work', mode: 'existing' },
    { id: 'Profile 2', name: 'IAS', mode: 'existing' },
  ]);
  assert.equal(fake.getRemoteDebugPolicy('chrome').status, 'BLOCKED_BY_ORGANIZATION');
});

winTest('CDP verifier reports invalid clients, invalid JSON and transport failures safely', async () => {
  const invalid = service.createBrowserDebugService({ fetch: null });
  assert.equal((await invalid.verifyEndpoint(1)).reason, 'invalid-client');
  const invalidJson = service.createBrowserDebugService({ fetch: async () => ({ ok: true, text: async () => 'not-json' }) });
  assert.equal((await invalidJson.verifyEndpoint(9238)).status, 'Port conflict');
  const httpError = service.createBrowserDebugService({ fetch: async () => ({ ok: false, status: 503, text: async () => '{}' }) });
  assert.equal((await httpError.verifyEndpoint(9238)).reason, 'http-503');
  const transport = service.createBrowserDebugService({ fetch: async () => { throw new Error('offline'); } });
  assert.equal((await transport.verifyEndpoint(9238)).status, 'Browser is not running');
});

winTest('when every preferred port is occupied, the service allocates a free loopback port', async () => {
  const fake = service.createBrowserDebugService({
    fetch: async () => ({ ok: true, text: async () => JSON.stringify({ Browser: 'Other/1', webSocketDebuggerUrl: 'ws://127.0.0.1:9222/devtools/browser/x' }) }),
    canBindPort: () => false,
  });
  const result = await fake.resolveDebugPort('edge', 9222);
  assert.equal(Number.isInteger(result.port), true);
  assert.ok(result.port >= 1024 && result.port <= 65535);
});

/* v7.83: kurulum artık ÖNCE mevcut CDP uç noktasını arar; yalnız hiçbir
   geçerli uç nokta yokken başlatma yapar. Bu senaryo "yeni bilgisayar"
   durumudur: başlatmadan önce hiçbir port cevap vermez. */
winTest('enable and launch uses one stable Chrome profile and only spawns after policy/endpoint checks', async () => {
  const launches = [];
  const fake = service.createBrowserDebugService({
    localDataRoot: path.join('C:', 'Users', 'test', 'BuyerLog'),
    launchTimeoutMs: 500,
    env: { LOCALAPPDATA: 'C:\\Users\\test\\AppData\\Local', PROGRAMFILES: 'C:\\Program Files', 'PROGRAMFILES(X86)': '' },
    fs: {
      existsSync: item => item.endsWith('chrome.exe'),
      readFileSync: () => { throw new Error('missing'); },
      mkdirSync: () => {},
    },
    writeJson: () => {},
    spawnSync: () => ({ stdout: 'Google Chrome 140.0.1' }),
    spawn: (executable, args, options) => { launches.push({ executable, args, options }); return { pid: 42, unref() {} }; },
    readRegistry: () => '',
    fetch: async () => (launches.length
      ? { ok: true, text: async () => JSON.stringify({ Browser: 'Chrome/140', webSocketDebuggerUrl: 'ws://127.0.0.1:49877/devtools/browser/test' }) }
      : { ok: false, status: 404, text: async () => '{}' }),
    processRunning: () => false,
    canBindPort: () => true,
  });
  const result = await fake.enableAndLaunch({ preferredBrowser: 'chrome', preferredPort: 49877 });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.endpoint.port, 49877);
  assert.equal(launches.length, 1);
  assert.match(launches[0].args[0], /browser-profiles[\\/]chrome/);
  assert.equal(launches[0].options.shell, false);
  assert.ok(!launches[0].args.some(arg => arg.startsWith('--remote-allow-origins')));
});

winTest('Settings exposes the central Browser & Remote Debugging flow', () => {
  const index = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
  const app = fs.readFileSync(path.join(__dirname, '..', 'public', 'app-main.js'), 'utf8');
  const server = fs.readFileSync(path.join(__dirname, '..', 'server', 'server.js'), 'utf8');
  /* v7.81: "Kaynak Veri" ayarlar menüsü kaldırıldı; bu iş Veri Yönetimi
     ekranındaki Araçlar bölümünde ve artık ne yaptığını da yazıyor. */
  const dmUi = fs.readFileSync(path.join(__dirname, '..', 'public', 'data-management.js'), 'utf8');
  assert.match(dmUi, /id: 'browser'/);
  assert.match(dmUi, /openBrowserDebugSettingsModal\(\)/);
  assert.match(app, /openBrowserDebugSettingsModal/);
  assert.match(app, /Enable & Launch/);
  assert.match(server, /\/api\/browser-debug\/enable/);
  assert.match(server, /requireAnyArea\('agents', 'automations'\)/);
});

/* ====================================================================
   v7.83 — Remote Debugging kurulumu: kanonik ayar yolu, yeniden kullanım,
   sınırlı yeniden başlatma ve tek kanonik işlem.
   ==================================================================== */

winTest('v7.83 settings file lives under the canonical writable Buyer Log root, not the device-local browser root', () => {
  const canonical = path.join('C:', 'BuyerLogPortable', 'data', 'app');
  const fake = service.createBrowserDebugService({
    canonicalDataRoot: canonical,
    env: { BL_HOST_LOCALAPPDATA: 'C:\\Users\\test\\AppData\\Local', LOCALAPPDATA: 'C:\\BuyerLogPortable\\local' },
  });
  assert.equal(fake.configFile, path.join(canonical, 'settings', 'browser-debug-settings.json'));
  // Profil klasörü bilerek cihaz-yerel kalır; ayar dosyası oraya yazılmaz.
  assert.equal(fake.localDataRoot, path.resolve('C:\\Users\\test\\AppData\\Local\\BuyerLog'));
  assert.ok(!fake.configFile.startsWith(fake.localDataRoot));
});

winTest('v7.83 a settings file left in the old location is migrated once into the canonical path', () => {
  const canonical = path.join('C:', 'BuyerLogData');
  const legacy = path.join(path.resolve('C:\\Users\\test\\AppData\\Local\\BuyerLog'), 'browser-debug-settings.json');
  const writes = [];
  const fake = service.createBrowserDebugService({
    canonicalDataRoot: canonical,
    env: { BL_HOST_LOCALAPPDATA: 'C:\\Users\\test\\AppData\\Local', LOCALAPPDATA: 'C:\\BuyerLogPortable\\local' },
    fs: { existsSync: item => item === legacy, readFileSync: () => JSON.stringify({ preferredBrowser: 'edge', preferredPort: 9222, enabled: true }), mkdirSync: () => {} },
    writeJson: (file, value) => writes.push({ file, value }),
  });
  assert.equal(fake.loadConfiguration().preferredBrowser, 'edge');
  assert.equal(writes.length, 1);
  assert.equal(writes[0].file, fake.configFile);
  fake.loadConfiguration();
  assert.equal(writes.length, 1, 'migration must not repeat on every read');
});

function existingProfileService(overrides = {}) {
  const userData = path.join('C:', 'Users', 'test', 'AppData', 'Local', 'Microsoft', 'Edge', 'User Data');
  return service.createBrowserDebugService({
    canonicalDataRoot: path.join('C:', 'BuyerLogData'),
    localDataRoot: path.join('C:', 'Users', 'test', 'BuyerLog'),
    launchTimeoutMs: 400,
    env: { LOCALAPPDATA: 'C:\\Users\\test\\AppData\\Local', PROGRAMFILES: 'C:\\Program Files', 'PROGRAMFILES(X86)': '' },
    fs: {
      existsSync: item => item.endsWith('msedge.exe') || item === path.join(userData, 'Local State'),
      readdirSync: () => [{ name: 'Default', isDirectory: () => true }],
      readFileSync: file => {
        if (String(file).endsWith('Local State')) return JSON.stringify({ info_cache: { Default: { name: 'Work' } } });
        throw new Error('missing');
      },
      mkdirSync: () => {},
    },
    writeJson: () => {},
    spawnSync: () => ({ stdout: 'Microsoft Edge 140' }),
    readRegistry: () => '',
    canBindPort: () => true,
    ...overrides,
  });
}

winTest('v7.83 the existing Edge profile is launched with its own user-data-dir so Chromium cannot hand off and exit', async () => {
  const launches = [];
  const fake = existingProfileService({
    spawn: (executable, args) => { launches.push(args); return { pid: 7, unref() {} }; },
    processRunning: () => false,
    fetch: async () => (launches.length
      ? { ok: true, text: async () => JSON.stringify({ Browser: 'Microsoft Edge/140', webSocketDebuggerUrl: 'ws://127.0.0.1:9222/devtools/browser/x' }) }
      : { ok: false, status: 404, text: async () => '{}' }),
  });
  const result = await fake.enableAndLaunch({ preferredBrowser: 'edge', preferredPort: 9222 });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.strategy.mode, 'existing');
  assert.equal(launches.length, 1);
  assert.ok(launches[0].some(arg => /^--user-data-dir=.*Microsoft[\\/]Edge[\\/]User Data$/i.test(arg)), launches[0].join(' '));
  assert.ok(launches[0].includes('--profile-directory=Default'));
});

winTest('v7.83 a second setup call reuses the verified endpoint instead of restarting the browser', async () => {
  const launches = [];
  const fake = existingProfileService({
    spawn: (executable, args) => { launches.push(args); return { pid: 8, unref() {} }; },
    processRunning: () => false,
    fetch: async () => (launches.length
      ? { ok: true, text: async () => JSON.stringify({ Browser: 'Microsoft Edge/140', webSocketDebuggerUrl: 'ws://127.0.0.1:9222/devtools/browser/x' }) }
      : { ok: false, status: 404, text: async () => '{}' }),
  });
  assert.equal((await fake.enableAndLaunch({ preferredBrowser: 'edge', preferredPort: 9222 })).ok, true);
  const second = await fake.enableAndLaunch({ preferredBrowser: 'edge', preferredPort: 9222 });
  assert.equal(second.ok, true);
  assert.equal(second.reused, true);
  assert.equal(launches.length, 1, 'an already valid CDP endpoint must not cause a second launch');
});

winTest('v7.83 a running browser without CDP stops at a bounded ERROR instead of looping launch/close', async () => {
  const launches = [];
  const fake = existingProfileService({
    spawn: (executable, args) => { launches.push(args); return { pid: 9, unref() {} }; },
    processRunning: () => true,
    fetch: async () => ({ ok: false, status: 404, text: async () => '{}' }),
  });
  const result = await fake.enableAndLaunch({ preferredBrowser: 'edge', preferredPort: 9222 });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'browser-running');
  assert.equal(result.status, 'Browser restart required');
  assert.equal(launches.length, 0, 'setup must never spawn a browser that will be handed off to the running singleton');
  const status = await fake.getRuntimeStatus();
  assert.equal(status.state, 'ERROR', 'ERROR must not fall back to PREPARING on its own');
});

winTest('v7.83 an explicit restart closes the browser once, without /F, and then launches the same profile', async () => {
  const launches = [];
  const closes = [];
  let running = true;
  const fake = existingProfileService({
    spawn: (executable, args) => { launches.push(args); return { pid: 10, unref() {} }; },
    processRunning: () => running,
    closeBrowser: browser => { closes.push(browser); running = false; return true; },
    fetch: async () => (launches.length
      ? { ok: true, text: async () => JSON.stringify({ Browser: 'Microsoft Edge/140', webSocketDebuggerUrl: 'ws://127.0.0.1:9222/devtools/browser/x' }) }
      : { ok: false, status: 404, text: async () => '{}' }),
  });
  const result = await fake.restartWithRemoteDebugging({ preferredBrowser: 'edge', preferredPort: 9222 });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.deepEqual(closes, ['edge']);
  assert.equal(launches.length, 1, 'at most one controlled restart per setup invocation');
});

winTest('v7.83 parallel setup requests share one canonical operation', async () => {
  const launches = [];
  const fake = existingProfileService({
    spawn: (executable, args) => { launches.push(args); return { pid: 11, unref() {} }; },
    processRunning: () => false,
    fetch: async () => (launches.length
      ? { ok: true, text: async () => JSON.stringify({ Browser: 'Microsoft Edge/140', webSocketDebuggerUrl: 'ws://127.0.0.1:9222/devtools/browser/x' }) }
      : { ok: false, status: 404, text: async () => '{}' }),
  });
  const input = { preferredBrowser: 'edge', preferredPort: 9222 };
  const results = await Promise.all([fake.enableAndLaunch(input), fake.enableAndLaunch(input), fake.restartWithRemoteDebugging(input)]);
  assert.ok(results.every(item => item.ok));
  assert.equal(launches.length, 1);
});

winTest('v7.83 a foreign Chromium on the default port is not adopted as the resolved browser endpoint', async () => {
  const launches = [];
  const fake = existingProfileService({
    spawn: (executable, args) => { launches.push(args); return { pid: 12, unref() {} }; },
    processRunning: () => false,
    // Portta Chrome cevap veriyor ama cozumlenen tarayici Edge.
    fetch: async url => {
      const port = Number(String(url).match(/:(\d+)\//)[1]);
      const browser = launches.length ? 'Microsoft Edge/140' : 'Chrome/140';
      return { ok: true, text: async () => JSON.stringify({ Browser: browser, webSocketDebuggerUrl: `ws://127.0.0.1:${port}/devtools/browser/x` }) };
    },
  });
  const result = await fake.enableAndLaunch({ preferredBrowser: 'edge', preferredPort: 9222 });
  assert.equal(result.ok, true);
  assert.equal(result.reused, undefined, 'an endpoint owned by another browser must not be reused');
  assert.equal(launches.length, 1);
});

winTest('v7.83 modal buttons capture the trigger synchronously so closing the modal cannot null-deref disabled', () => {
  const app = fs.readFileSync(path.join(__dirname, '..', 'public', 'app-main.js'), 'utf8');
  const start = app.indexOf('async function openBrowserDebugSettingsModal(');
  assert.ok(start > 0);
  const end = app.indexOf('\nfunction findModelImagePreviewSource(', start);
  assert.ok(end > start);
  // Yorumlar ayiklanir: doesNotMatch yoksa aciklama metnini de eslestirir.
  const modalSource = app.slice(start, end).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  // currentTarget ilk await'ten sonra null olur; finally icinde kullanilamaz.
  assert.doesNotMatch(modalSource, /e\.currentTarget\.disabled/);
  assert.match(modalSource, /const trigger=event\.currentTarget/);
  assert.match(modalSource, /trigger\.isConnected/);
  assert.match(modalSource, /modal\.isConnected/);
  assert.match(modalSource, /data-restart/);
});

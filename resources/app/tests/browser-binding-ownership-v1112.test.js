'use strict';
/* ======================================================================
   v11.12 — TARAYICI BAĞLAMASI YETKİLİ KAYNAKTIR

   Dört ayrı regression bu dosyada korunur:

   PORT_ENDPOINT_OWNERSHIP
     "Port cevap veriyor" bir kanıt değildi. /json/version'da "Microsoft Edge"
     yazan HER uç nokta devralınıyordu; aynı makinedeki ikinci bir Edge
     kurulumu/süreci (yani BAŞKA BİRİNİN oturumu) 9222'yi tutuyorsa Buyer Log
     oraya bağlanıyordu. Sahiplik artık seçili profilin kendi
     DevToolsActivePort dosyasındaki port + tarayıcı GUID'i ile kanıtlanır.

   NO_SILENT_PROFILE_FALLBACK
     Kayıtlı profil bu makinede yoksa listenin ilk profiline düşülüyordu.
     Kullanıcı Ayarlar'da kendi profilini seçili görüyor, iş ise başka
     profilde yürüyordu. Artık PROFILE_NOT_FOUND ile durulur.

   PORTABLE_MACHINE_REBIND
     Paket başka bilgisayara kopyalandığında kaynak makinenin profili ve
     portu hedefte yetkili sayılmaz; cihaz mührü tutmazsa düşürülür ve
     hedefte hiçbir koşulda kaynak makinenin portuna uzanılmaz.

   MULTI_PROFILE_PROFILE_AFFINITY
     Bağlama hazır değilken akış sessizce eski keşfe düşüyor ve cevap veren
     ilk Edge profiline bağlanıyordu. Artık düşüş yok: ne yapılacağı söylenir.
   ====================================================================== */
const test = require('node:test');
const winTest = process.platform === 'win32' ? test : test.skip;
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const service = require('../server/lib/browser-debug-service.js');

const USER_DATA = path.join('C:', 'Users', 'test', 'AppData', 'Local', 'Microsoft', 'Edge', 'User Data');
const SETTINGS = path.join('C:', 'BuyerLogData', 'settings', 'browser-debug-settings.json');
const THIS_DEVICE = 'a'.repeat(32);
const OTHER_DEVICE = 'b'.repeat(32);

function cdpResponse(guid, port, browser = 'Microsoft Edge/140') {
  return { ok: true, text: async () => JSON.stringify({ Browser: browser, webSocketDebuggerUrl: `ws://127.0.0.1:${port}/devtools/browser/${guid}` }) };
}
const NO_SERVER = { ok: false, status: 404, text: async () => '{}' };

/* Portlara göre cevap veren sahte CDP ağı. Sorulan portlar kaydedilir:
   "hedef makinede kaynak makinenin portuna hiç uzanılmadı" iddiası ancak
   böyle kanıtlanabilir. */
function cdpNetwork(map) {
  const asked = [];
  const fetchImpl = async url => {
    const port = Number(new URL(String(url)).port);
    asked.push(port);
    const entry = map[port];
    return typeof entry === 'function' ? entry() : (entry || NO_SERVER);
  };
  return { fetchImpl, asked };
}

function makeService({ profiles = ['Default'], info = {}, devtools = null, configuration = null, version = 'Microsoft Edge 140', ...overrides } = {}) {
  const files = new Map();
  files.set(path.join(USER_DATA, 'Local State'), JSON.stringify({ info_cache: info }));
  if (devtools) files.set(path.join(USER_DATA, 'DevToolsActivePort'), devtools);
  if (configuration) files.set(SETTINGS, JSON.stringify(configuration));
  const created = service.createBrowserDebugService({
    canonicalDataRoot: path.join('C:', 'BuyerLogData'),
    localDataRoot: path.join('C:', 'Users', 'test', 'BuyerLog'),
    launchTimeoutMs: 300,
    deviceId: THIS_DEVICE,
    env: { LOCALAPPDATA: 'C:\\Users\\test\\AppData\\Local', PROGRAMFILES: 'C:\\Program Files', 'PROGRAMFILES(X86)': '', COMPUTERNAME: 'PC-1', USERNAME: 'test' },
    fs: {
      existsSync: item => String(item).endsWith('msedge.exe') || files.has(String(item)),
      // Profil klasörleri yalnız gerçek kullanıcı veri kökünde durur; kurulum
      // klasörü boştur, böylece sürüm 0 kalır ve "mevcut profil" yolu sınanır.
      readdirSync: (dir, opts) => (String(dir) === USER_DATA && opts ? profiles.map(name => ({ name, isDirectory: () => true })) : []),
      readFileSync: file => { const value = files.get(String(file)); if (value == null) throw new Error('missing'); return value; },
      mkdirSync: () => {},
    },
    writeJson: (file, value) => { files.set(String(file), JSON.stringify(value)); },
    spawnSync: () => ({ stdout: version }),
    readRegistry: () => '',
    canBindPort: () => true,
    processRunning: () => false,
    ...overrides,
  });
  created.__files = files;
  return created;
}

function enabledConfig(extra = {}) {
  return { schemaVersion: 1, preferredBrowser: 'edge', selectedEdgeProfileDirectory: 'Default', preferredPort: 9222, enabled: true, deviceId: THIS_DEVICE, ...extra };
}

/* ---------------------------------------------------------------- */
/* PORT_ENDPOINT_OWNERSHIP                                           */
/* ---------------------------------------------------------------- */

winTest('PORT_ENDPOINT_OWNERSHIP · profilin DevToolsActivePort GUID’i eşleşince uç nokta sahiplenilir', async () => {
  const net = cdpNetwork({ 9222: cdpResponse('browser-guid-1', 9222) });
  const svc = makeService({ devtools: '9222\n/devtools/browser/browser-guid-1\n', configuration: enabledConfig(), fetch: net.fetchImpl });
  const result = await svc.testConnection();
  assert.equal(result.connectionState, 'READY', JSON.stringify(result.checks));
  assert.equal(result.ok, true);
  assert.equal(result.binding.profileDirectory, 'Default');
  assert.equal(result.binding.browserGuid, 'browser-guid-1');
  assert.equal(result.binding.ownership.source, 'devtools-active-port');
  assert.ok(result.binding.profileFingerprint, 'profil parmak izi üretilmeli');
});

winTest('PORT_ENDPOINT_OWNERSHIP · aynı portta BAŞKA bir tarayıcı süreci varsa devralınmaz', async () => {
  // Profil 9222'yi kendi GUID'iyle kaydetmiş, ama porta cevap veren süreç
  // başka bir Edge. Eski kod "Microsoft Edge" yazdığı için bağlanıyordu.
  const net = cdpNetwork({ 9222: cdpResponse('someone-elses-browser', 9222) });
  const svc = makeService({ devtools: '9222\n/devtools/browser/browser-guid-1\n', configuration: enabledConfig(), fetch: net.fetchImpl });
  const result = await svc.testConnection();
  assert.equal(result.connectionState, 'PORT_CONFLICT');
  assert.equal(result.ok, false);
  assert.equal(result.portConflict.reason, 'stale-endpoint');
  assert.equal(result.binding, null, 'sahipliği kanıtlanmamış uç nokta bağlama üretmemeli');
});

winTest('PORT_ENDPOINT_OWNERSHIP · seçili profil BAŞKA portta açıksa, cevap veren yabancı port sahiplenilmez', async () => {
  // Seçili profilin kendi süreci 9333'te; 9222'yi tutan Edge başka bir
  // kullanıcı veri klasörünün (yani başka bir profilin) sürecidir.
  const net = cdpNetwork({ 9222: cdpResponse('foreign-profile', 9222) });
  const svc = makeService({ devtools: '9333\n/devtools/browser/mine\n', configuration: enabledConfig(), fetch: net.fetchImpl });
  const result = await svc.testConnection();
  assert.equal(result.connectionState, 'PORT_CONFLICT');
  assert.equal(result.portConflict.reason, 'endpoint-belongs-to-another-browser');
});

winTest('PORT_ENDPOINT_OWNERSHIP · CDP konuşan yabancı bir Chromium (Chrome) Edge yerine geçmez', async () => {
  const net = cdpNetwork({ 9222: cdpResponse('chrome-guid', 9222, 'Chrome/140') });
  const svc = makeService({ devtools: '9222\n/devtools/browser/chrome-guid\n', configuration: enabledConfig(), fetch: net.fetchImpl });
  const result = await svc.testConnection();
  assert.equal(result.connectionState, 'PORT_CONFLICT');
  assert.equal(result.portConflict.reason, 'foreign-browser');
});

winTest('PORT_ENDPOINT_OWNERSHIP · Buyer Log’un KENDİ başlattığı port sahiplik kanıtıdır', async () => {
  // DevToolsActivePort dosyası yok (tarayıcı henüz yazmamış olabilir); ama
  // portu bu profil için biz açtık. İkinci çağrı yeniden başlatmaz.
  const launches = [];
  let live = false;
  const net = cdpNetwork({ 9222: () => (live ? cdpResponse('launched-guid', 9222) : NO_SERVER) });
  const svc = makeService({
    configuration: enabledConfig(),
    fetch: net.fetchImpl,
    spawn: (executable, args) => { launches.push(args); live = true; return { pid: 11, unref() {} }; },
  });
  const first = await svc.enableAndLaunch({ preferredBrowser: 'edge', selectedEdgeProfileDirectory: 'Default', preferredPort: 9222 });
  assert.equal(first.ok, true, JSON.stringify(first));
  assert.equal(launches.length, 1);
  assert.equal(first.endpoint.binding.ownership.source, 'launch-owned');
  const second = await svc.enableAndLaunch({ preferredBrowser: 'edge', selectedEdgeProfileDirectory: 'Default', preferredPort: 9222 });
  assert.equal(second.reused, true);
  assert.equal(launches.length, 1, 'doğrulanmış ve sahiplenilmiş uç nokta ikinci kez tarayıcı başlatmamalı');
});

winTest('PORT_ENDPOINT_OWNERSHIP · sahipliği kanıtlanamayan port DOLU sayılır, başka port hazırlanır', async () => {
  const launches = [];
  const net = cdpNetwork({ 9222: cdpResponse('foreign', 9222), 9223: NO_SERVER });
  const svc = makeService({
    configuration: enabledConfig(),
    fetch: net.fetchImpl,
    spawn: (executable, args) => { launches.push(args); return { pid: 12, unref() {} }; },
  });
  const result = await svc.enableAndLaunch({ preferredBrowser: 'edge', selectedEdgeProfileDirectory: 'Default', preferredPort: 9222 });
  // CDP hiç gelmedi: sonuç başarısız. Önemli olan, 9222'deki YABANCI uç
  // noktanın bağlantı diye kabul EDİLMEMİŞ olmasıdır.
  assert.equal(result.ok, false);
  assert.equal(result.connectionState, 'PORT_CONFLICT');
  assert.ok(launches.length <= 1);
  assert.ok(!launches.some(args => args.includes('--remote-debugging-port=9222')), 'yabancı sürecin tuttuğu port yeniden kullanılmamalı');
});

/* ---------------------------------------------------------------- */
/* NO_SILENT_PROFILE_FALLBACK                                        */
/* ---------------------------------------------------------------- */

winTest('NO_SILENT_PROFILE_FALLBACK · bu makinede olmayan seçim listenin ilk profiline DÜŞMEZ', async () => {
  const launches = [];
  const net = cdpNetwork({});
  const svc = makeService({
    profiles: ['Default', 'Profile 1'],
    info: { Default: { name: 'Kişisel' }, 'Profile 1': { name: 'Kurumsal' } },
    configuration: enabledConfig({ selectedEdgeProfileDirectory: 'Profile 3' }),
    fetch: net.fetchImpl,
    spawn: (executable, args) => { launches.push(args); return { pid: 13, unref() {} }; },
  });
  const result = await svc.enableAndLaunch({ preferredBrowser: 'edge', selectedEdgeProfileDirectory: 'Profile 3' });
  assert.equal(result.ok, false);
  assert.equal(result.connectionState, 'PROFILE_NOT_FOUND');
  assert.equal(result.reason, 'profile-not-found');
  assert.equal(launches.length, 0, 'eksik profil için tarayıcı başlatılmamalı');
  const tested = await svc.testConnection();
  assert.equal(tested.connectionState, 'PROFILE_NOT_FOUND');
  assert.equal(tested.binding, null);
});

winTest('NO_SILENT_PROFILE_FALLBACK · birden çok profil varken seçimsiz başlatılmaz', async () => {
  const launches = [];
  const svc = makeService({
    profiles: ['Default', 'Profile 1'],
    configuration: enabledConfig({ selectedEdgeProfileDirectory: '' }),
    fetch: cdpNetwork({}).fetchImpl,
    spawn: (executable, args) => { launches.push(args); return { pid: 14, unref() {} }; },
  });
  const result = await svc.enableAndLaunch({ preferredBrowser: 'edge', selectedEdgeProfileDirectory: '' });
  assert.equal(result.connectionState, 'PROFILE_REQUIRED');
  assert.equal(launches.length, 0);
});

winTest('NO_SILENT_PROFILE_FALLBACK · TEK profil varsa seçim kendiliğinden yapılabilir', async () => {
  const launches = [];
  let live = false;
  const net = cdpNetwork({ 9222: () => (live ? cdpResponse('single-guid', 9222) : NO_SERVER) });
  const svc = makeService({
    profiles: ['Default'],
    configuration: enabledConfig({ selectedEdgeProfileDirectory: '' }),
    fetch: net.fetchImpl,
    spawn: (executable, args) => { launches.push(args); live = true; return { pid: 15, unref() {} }; },
  });
  const result = await svc.enableAndLaunch({ preferredBrowser: 'edge', selectedEdgeProfileDirectory: '', preferredPort: 9222 });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(launches.length, 1);
  assert.ok(launches[0].includes('--profile-directory=Default'));
});

winTest('NO_SILENT_PROFILE_FALLBACK · durum ekranı da eksik profili bildirir', async () => {
  const svc = makeService({
    profiles: ['Default', 'Profile 1'],
    configuration: enabledConfig({ selectedEdgeProfileDirectory: 'Profile 7' }),
    fetch: cdpNetwork({}).fetchImpl,
  });
  const status = await svc.getRuntimeStatus();
  assert.equal(status.connectionState, 'PROFILE_NOT_FOUND');
  assert.equal(status.selectedProfileDirectory, 'Profile 7');
  assert.equal(status.binding, null);
});

/* ---------------------------------------------------------------- */
/* PORTABLE_MACHINE_REBIND                                           */
/* ---------------------------------------------------------------- */

winTest('PORTABLE_MACHINE_REBIND · kaynak makinenin profili/portu hedefte kullanılmaz', async () => {
  const net = cdpNetwork({ 9444: cdpResponse('source-machine', 9444), 9222: NO_SERVER });
  const svc = makeService({
    profiles: ['Default'],
    configuration: { schemaVersion: 1, preferredBrowser: 'edge', selectedEdgeProfileDirectory: 'Profile 3', preferredPort: 9444, enabled: true, deviceId: OTHER_DEVICE },
    fetch: net.fetchImpl,
  });
  const configuration = svc.loadConfiguration();
  assert.equal(configuration.selectedEdgeProfileDirectory, '', 'kaynak PC profili hedefte yetkili değildir');
  assert.equal(configuration.preferredPort, null, 'kaynak PC portu hedefte yetkili değildir');
  assert.equal(configuration.enabled, false);
  assert.equal(svc.deviceBinding().rebound, true);
  const status = await svc.getRuntimeStatus();
  assert.equal(status.connectionState, 'DISABLED');
  assert.ok(!net.asked.includes(9444), 'hedef makinede kaynak makinenin portuna hiç uzanılmamalı');
});

winTest('PORTABLE_MACHINE_REBIND · kullanıcı tercihi (tarayıcı) korunur, keşif hedefte yeniden yapılır', () => {
  const svc = makeService({
    profiles: ['Default', 'Profile 1'],
    configuration: { schemaVersion: 1, preferredBrowser: 'edge', selectedEdgeProfileDirectory: 'Profile 3', preferredPort: 9444, enabled: true, deviceId: OTHER_DEVICE },
    fetch: cdpNetwork({}).fetchImpl,
  });
  assert.equal(svc.loadConfiguration().preferredBrowser, 'edge', 'zararsız kullanıcı tercihi taşınabilir');
  assert.deepEqual(svc.listBrowserProfiles('edge').map(item => item.id), ['Default', 'Profile 1'], 'profiller hedef makinede yeniden keşfedilir');
});

/* ---------------------------------------------------------------- */
/* MULTI_PROFILE_PROFILE_AFFINITY (kaynak sözleşmesi)                */
/* ---------------------------------------------------------------- */

const stripComments = text => String(text).replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^[^\n]*?\/\/[^\n]*$/gm, ' ');
const CONNECTOR = fs.readFileSync(path.join(__dirname, '..', 'server', 'lib', 'agent-browser-connector.js'), 'utf8');
const APP = fs.readFileSync(path.join(__dirname, '..', 'public', 'app-main.js'), 'utf8');

winTest('MULTI_PROFILE_PROFILE_AFFINITY · bağlama hazır değilken eski keşfe DÜŞÜLMEZ', () => {
  const body = CONNECTOR.slice(CONNECTOR.indexOf('async function connectPreferredEdge('), CONNECTOR.indexOf('\nfunction openExistingEdgeDebugSetup'));
  const code = stripComments(body);
  const managed = code.indexOf('if (managed) return managed;');
  const legacy = code.indexOf('await connectExistingEdge(');
  assert.ok(managed > 0 && legacy > managed, 'yönetilen yol eski keşiften önce gelmeli');
  // Yönetilen dal ile eski keşif arasında MUTLAKA bir çıkış olmalı; aksi
  // hâlde hazırlıksız bağlama sessizce "cevap veren ilk Edge"e düşer.
  assert.match(code.slice(managed, legacy), /throw connectorError\(managedBindingMessage\(status\)/);
});

winTest('MULTI_PROFILE_PROFILE_AFFINITY · her engelleyici durum için uygulanabilir bir mesaj vardır', () => {
  const block = CONNECTOR.slice(CONNECTOR.indexOf('function managedBindingMessage('), CONNECTOR.indexOf('async function connectPreferredEdge('));
  for (const state of ['DISABLED', 'PROFILE_REQUIRED', 'PROFILE_NOT_FOUND', 'REMOTE_DEBUG_DISABLED', 'PORT_CONFLICT', 'ENDPOINT_UNVERIFIED', 'CONTEXT_MISMATCH']) {
    assert.match(block, new RegExp(`\\b${state}:`), `${state} için mesaj tanımlı olmalı`);
  }
});

winTest('MULTI_PROFILE_PROFILE_AFFINITY · sabitlenen bağlam kimliği bağlamaya bildirilir', () => {
  assert.match(CONNECTOR, /publishBoundContext\?\.\(\{browserContextId:pinned\.browserContextId/);
  // Bağlantı koptuğunda kimlik de düşer; bayat bir bağlam kimliği bir sonraki
  // oturumda "doğrulanmış" görünmemeli.
  assert.match(CONNECTOR, /clearProfileAffinity\(context\);browserDebugManager\(\)\?\.publishBoundContext\?\.\(null\)/);
});

winTest('MULTI_PROFILE_PROFILE_AFFINITY · arayüz eksik profil yerine BAŞKASINI seçili göstermez', () => {
  assert.doesNotMatch(APP, /if\(\[\.\.\.profile\.options\]\.some\(o=>o\.value===selected\)\)profile\.value=selected;/);
  assert.match(APP, /profile\.value=known\?selected:'';/);
  assert.match(APP, /Seçili profil bu bilgisayarda yok/);
  // "Connected" yalnız kanonik READY durumunda yazılır.
  assert.match(APP, /state==='READY'&&endpoint&&endpoint\.port/);
});

winTest('MULTI_PROFILE_PROFILE_AFFINITY · tanı çıktısı sır taşımaz', async () => {
  const net = cdpNetwork({ 9222: cdpResponse('guid-x', 9222) });
  const svc = makeService({ devtools: '9222\n/devtools/browser/guid-x\n', configuration: enabledConfig(), fetch: net.fetchImpl });
  const result = await svc.testConnection();
  const serialized = JSON.stringify(result);
  assert.doesNotMatch(serialized, /authorization|bearer|cookie|set-cookie|password/i);
  assert.match(serialized, /"browserGuid":"guid-x"/, 'güvenli tanı alanları görünmeli');
});

winTest('MULTI_PROFILE_PROFILE_AFFINITY · sabitlenmiş bağlam başka profile aitse READY verilmez', async () => {
  const net = cdpNetwork({ 9222: cdpResponse('guid-y', 9222) });
  const svc = makeService({
    profiles: ['Default', 'Profile 1'],
    devtools: '9222\n/devtools/browser/guid-y\n',
    configuration: enabledConfig({ selectedEdgeProfileDirectory: 'Profile 1' }),
    fetch: net.fetchImpl,
  });
  // Bağlayıcı, bağlamı "Default" profili için sabitlemiş; seçim ise "Profile 1".
  svc.publishBoundContext({ browserContextId: 'ctx-1', source: 'connect-time-profile', profileDirectory: 'Default' });
  const result = await svc.testConnection();
  assert.equal(result.connectionState, 'CONTEXT_MISMATCH');
  assert.equal(result.ok, false);
  assert.equal(result.checks.find(item => item.key === 'context').ok, false);
});

winTest('MULTI_PROFILE_PROFILE_AFFINITY · bağlam seçili profille aynıysa READY korunur', async () => {
  const net = cdpNetwork({ 9222: cdpResponse('guid-z', 9222) });
  const svc = makeService({
    profiles: ['Default', 'Profile 1'],
    devtools: '9222\n/devtools/browser/guid-z\n',
    configuration: enabledConfig({ selectedEdgeProfileDirectory: 'Profile 1' }),
    fetch: net.fetchImpl,
  });
  svc.publishBoundContext({ browserContextId: 'ctx-2', source: 'connect-time-profile', profileDirectory: 'Profile 1' });
  const result = await svc.testConnection();
  assert.equal(result.connectionState, 'READY', JSON.stringify(result.checks));
  assert.equal(result.binding.browserContextIdentity.browserContextId, 'ctx-2');
});

/* ----------------------------------------------------------------
   Enable & Launch belirlenimciliği: Buyer Log'un KENDİ profili
   kullanıcının açık tarayıcısına rehin değildir.
   ---------------------------------------------------------------- */

winTest('ENABLE_AND_LAUNCH · kalıcı profil, kullanıcının açık Edge’i yüzünden bloke edilmez', async () => {
  // Chromium 136+ gerçek profilde remote debugging'i kapattığı için tek yol
  // Buyer Log'un kendi klasörüdür. O klasörü kullanıcının Edge'i tutmaz;
  // singleton devri olamaz. Eskiden kullanıcı tüm tarayıcısını kapatmak
  // zorunda kalıyordu (Edge 153'te ölçüldü).
  const launches = [];
  let live = false;
  const net = cdpNetwork({ 9222: () => (live ? cdpResponse('persistent-guid', 9222) : NO_SERVER) });
  const svc = makeService({
    version: 'Microsoft Edge 153.0.4234.32',
    configuration: enabledConfig({ selectedEdgeProfileDirectory: '' }),
    fetch: net.fetchImpl,
    processRunning: () => true,
    spawn: (executable, args) => { launches.push(args); live = true; return { pid: 21, unref() {} }; },
  });
  const result = await svc.enableAndLaunch({ preferredBrowser: 'edge', preferredPort: 9222 });
  assert.equal(result.strategy.mode, 'buyer-log-persistent', 'Edge 153 gerçek profilde debug’a izin vermez');
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(launches.length, 1, 'kendi klasöründeki profil doğrudan başlatılmalı');
  assert.ok(launches[0].some(arg => /^--user-data-dir=.*browser-profiles[\\/]edge$/i.test(arg)), launches[0].join(' '));
});

winTest('ENABLE_AND_LAUNCH · gerçek kullanıcı profilinde singleton koruması KORUNUR', async () => {
  // Burada klasör tarayıcının kendi kökü: açık Edge onu gerçekten tutar ve
  // yeni süreç devredip kapanır. Kontrollü yeniden başlatma hâlâ şart.
  const launches = [];
  const svc = makeService({
    version: 'Microsoft Edge 135.0.1.1',
    configuration: enabledConfig(),
    fetch: cdpNetwork({}).fetchImpl,
    processRunning: () => true,
    spawn: (executable, args) => { launches.push(args); return { pid: 22, unref() {} }; },
  });
  const result = await svc.enableAndLaunch({ preferredBrowser: 'edge', selectedEdgeProfileDirectory: 'Default', preferredPort: 9222 });
  assert.equal(result.strategy.mode, 'existing');
  assert.equal(result.reason, 'browser-running');
  assert.equal(launches.length, 0, 'açık tarayıcı varken gerçek profil için süreç başlatılmamalı');
});


/* ----------------------------------------------------------------
   Edge 153 DevToolsActivePort yazmıyor: Buyer Log kendi kaydını tutar.
   ---------------------------------------------------------------- */

winTest('ENDPOINT_RECORD · sunucu yeniden başlasa da kendi tarayıcısı yeniden başlatılmaz', async () => {
  // Ölçülen gerçek: Edge 153 remote debugging açıkken DevToolsActivePort
  // YAZMIYOR. Kayıt olmadan sunucu yeniden başlayınca kendi tarayıcısını
  // bulamıyor, yeni port ayırıyor, Edge singleton'a devredip kapanıyordu.
  const launches = [];
  // Tarayıcı hangi portla başlatıldıysa CDP orada açılır (gerçek davranış).
  let livePort = 0;
  const fetchImpl = async url => {
    const port = Number(new URL(String(url)).port);
    return port && port === livePort ? cdpResponse('own-browser', port) : NO_SERVER;
  };
  const options = {
    version: 'Microsoft Edge 153.0.4234.32',
    configuration: enabledConfig({ selectedEdgeProfileDirectory: '', preferredPort: null }),
    fetch: fetchImpl,
    processRunning: () => true,
    spawn: (executable, args) => {
      launches.push(args);
      const flag = args.find(item => String(item).startsWith('--remote-debugging-port='));
      livePort = Number(String(flag || '').split('=')[1]) || 0;
      return { pid: 31, unref() {} };
    },
  };
  const first = makeService(options);
  const launched = await first.enableAndLaunch({ preferredBrowser: 'edge', preferredPort: null });
  assert.equal(launched.ok, true, JSON.stringify(launched));
  assert.equal(launches.length, 1);
  const record = first.readEndpointRecord();
  assert.ok(record && record.port === Number(launched.endpoint.port), 'uç nokta kaydı yazılmalı');
  assert.equal(record.browserGuid, 'own-browser');

  // Yeniden başlatılmış sunucu: bellekte hiçbir şey yok, yalnız disk var.
  const restarted = makeService(options);
  for (const [key, value] of first.__files) restarted.__files.set(key, value);
  const after = await restarted.testConnection();
  assert.equal(after.connectionState, 'READY', JSON.stringify(after.checks));
  assert.equal(after.binding.ownership.source, 'buyer-log-record');
  assert.equal(launches.length, 1, 'açık olan kendi tarayıcısı ikinci kez başlatılmamalı');
});

winTest('ENDPOINT_RECORD · kayıt cihazla mühürlüdür: kopyalanan paket onu kullanamaz', async () => {
  const net = cdpNetwork({ 9223: cdpResponse('own-browser', 9223) });
  const svc = makeService({
    version: 'Microsoft Edge 153.0.4234.32',
    configuration: enabledConfig({ selectedEdgeProfileDirectory: '', preferredPort: null }),
    fetch: net.fetchImpl,
  });
  svc.__files.set(svc.endpointRecordFile, JSON.stringify({ schemaVersion: 1, deviceId: OTHER_DEVICE, strategyKey: 'x|Default', port: 9223, browserGuid: 'own-browser' }));
  assert.equal(svc.readEndpointRecord(), null, 'yabancı mühürlü kayıt okunmamalı');
});

winTest('ENDPOINT_RECORD · port aynı ama süreç değiştiyse sahiplik düşer', async () => {
  const net = cdpNetwork({ 9223: cdpResponse('a-different-browser', 9223) });
  const svc = makeService({
    version: 'Microsoft Edge 153.0.4234.32',
    configuration: enabledConfig({ selectedEdgeProfileDirectory: '', preferredPort: null }),
    fetch: net.fetchImpl,
    processRunning: () => true,
  });
  const strategy = svc.resolveProfileStrategy(svc.resolveEffectiveBrowser(), svc.loadConfiguration());
  svc.__files.set(svc.endpointRecordFile, JSON.stringify({ schemaVersion: 1, deviceId: THIS_DEVICE, strategyKey: `${require('path').resolve(strategy.userDataDir).toLowerCase()}|Default`, port: 9223, browserGuid: 'own-browser' }));
  const result = await svc.testConnection();
  assert.equal(result.connectionState, 'PORT_CONFLICT');
  assert.equal(result.portConflict.reason, 'stale-endpoint');
});


/* ----------------------------------------------------------------
   Gerçek Edge kendini "Edg/<sürüm>" diye tanıtır.
   ---------------------------------------------------------------- */

winTest('EDGE_LABEL · gerçek Edge yanıtı ("Edg/153.0.4234.32") geçerli sayılır', () => {
  // Bu makinede ÖLÇÜLEN gerçek /json/version yanıtı. Eski desen /edge/i idi ve
  // sondaki "e" olmadığı için sağlıklı bağlantı "Port conflict · foreign-server"
  // diye reddediliyordu. Sınamalar uydurma "Microsoft Edge/140" kullandığı için
  // hata görünmüyordu.
  const ws = 'ws://127.0.0.1:9223/devtools/browser/9515fa82-b60b-4622-8737-388d94a30f5b';
  assert.equal(service.validateCdpVersion({ Browser: 'Edg/153.0.4234.32', webSocketDebuggerUrl: ws }, 9223).ok, true);
  assert.equal(service.validateCdpVersion({ Browser: 'Microsoft Edge/140', webSocketDebuggerUrl: ws }, 9223).ok, true);
  // DevTools konuşmayan sunucular hâlâ reddedilir.
  assert.equal(service.validateCdpVersion({ Browser: 'nginx/1.24', webSocketDebuggerUrl: ws }, 9223).ok, false);
});

winTest('EDGE_LABEL · "Edg/" etiketli uç nokta seçili profile bağlanabilir', async () => {
  const net = cdpNetwork({ 9223: cdpResponse('real-edge-guid', 9223, 'Edg/153.0.4234.32') });
  const svc = makeService({
    version: 'Microsoft Edge 153.0.4234.32',
    configuration: enabledConfig({ selectedEdgeProfileDirectory: '', preferredPort: 9223 }),
    fetch: net.fetchImpl,
    // Portu dinleyen süreç, seçili profilin klasörünü açmış: kesin sahiplik.
    listeningPid: () => 4242,
    processUserDataDir: () => require('path').join('C:', 'Users', 'test', 'BuyerLog', 'browser-profiles', 'edge'),
  });
  const result = await svc.testConnection();
  assert.equal(result.connectionState, 'READY', JSON.stringify(result.checks));
  assert.equal(result.binding.ownership.source, 'listening-process');
  assert.equal(result.binding.port, 9223);
});

winTest('LISTENING_PROCESS · portu dinleyen süreç BAŞKA klasör açtıysa bağlanılmaz', async () => {
  const net = cdpNetwork({ 9222: cdpResponse('other-edge', 9222, 'Edg/153.0.4234.32') });
  const svc = makeService({
    version: 'Microsoft Edge 153.0.4234.32',
    configuration: enabledConfig({ selectedEdgeProfileDirectory: '', preferredPort: 9222 }),
    fetch: net.fetchImpl,
    listeningPid: () => 777,
    processUserDataDir: () => require('path').join('C:', 'Users', 'someone-else', 'AppData', 'Local', 'Microsoft', 'Edge', 'User Data'),
  });
  const result = await svc.testConnection();
  assert.equal(result.connectionState, 'PORT_CONFLICT');
  assert.equal(result.portConflict.reason, 'endpoint-belongs-to-another-browser');
});

winTest('LISTENING_PROCESS · netstat ve komut satırı ayrıştırıcıları gerçek çıktıyı okur', () => {
  const netstat = [
    '  TCP    127.0.0.1:9223         0.0.0.0:0              LISTENING       124088',
    '  TCP    0.0.0.0:445            0.0.0.0:0              LISTENING       4',
  ].join('\n');
  assert.equal(service.parseListeningPid(netstat, 9223), 124088);
  // Dışa açık bir dinleyici Buyer Log'un uç noktası olamaz.
  assert.equal(service.parseListeningPid(netstat, 445), 0);
  const B = String.fromCharCode(92);
  assert.equal(service.parseUserDataDirArgument('"msedge.exe" --user-data-dir="C:' + B + 'a b' + B + 'edge" --profile-directory=Default'), 'C:' + B + 'a b' + B + 'edge');
  assert.equal(service.parseUserDataDirArgument('msedge.exe --user-data-dir=C:' + B + 'x' + B + 'edge --foo'), 'C:' + B + 'x' + B + 'edge');
  assert.equal(service.parseUserDataDirArgument('msedge.exe --foo'), '');
});

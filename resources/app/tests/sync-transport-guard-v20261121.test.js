'use strict';

/* OneDrive aktarım bekçisi: SYNC klasöründe OneDrive yükleme/indirmesi
   takıldığında Buyer Log bunu uçtan uca kanıtla algılar ve yalnız kullanıcı
   onaylı, geri alınabilir işlemler sunar. Bu dosya karar kurallarını (yanlış
   alarm üretmeme dahil), OneDrive komutlarının güvenli sınırlarını, ortak
   klasörde kalan yazma testi dosyası düzeltmesini ve arayüz bağlantısını sabitler. */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const guard = require('../server/lib/sync-transport-guard');
const { createOneDriveControl, parseRegistryRoots, isInside } = require('../server/lib/onedrive-control');
const { createSharedHub } = require('../server/lib/shared-hub');

const ROOT = path.join(__dirname, '..');
const NOW = Date.parse('2026-11-21T12:00:00.000Z');
const MIN = 60 * 1000;
const iso = ms => new Date(ms).toISOString();
const beacon = (deviceId, overrides = {}) => ({ schemaVersion: 1, deviceId, updatedAt: iso(NOW), lastSyncAt: iso(NOW), latestPublishedSeq: 0, publishedAt: null, seen: {}, ...overrides });

test('highestSeenBySource: checkpoint boşlukta takılsa da ötesinde alınan aralık görüldü sayılır', () => {
  const seen = guard.highestSeenBySource({
    syncCheckpoints: { a: 10, b: 4 },
    syncLedger: { receivedBeyondByDevice: { a: [{ first: 12, last: 20 }], c: [{ first: 3, last: 7 }] } },
  });
  assert.deepEqual(seen, { a: 20, b: 4, c: 7 });
});

test('recordPublication: yalnız sıra artınca ilk görülme anını kaydeder', () => {
  let list = guard.recordPublication([], { latestSequence: 5, updatedAt: iso(NOW - 2 * MIN) }, NOW);
  assert.deepEqual(list, [{ seq: 5, at: iso(NOW - 2 * MIN) }]);
  list = guard.recordPublication(list, { latestSequence: 5, updatedAt: iso(NOW) }, NOW);
  assert.equal(list.length, 1, 'aynı sırayla yeniden yazılan head yeni yayın değildir');
  list = guard.recordPublication(list, { latestSequence: 9, updatedAt: iso(NOW + 5 * MIN) }, NOW);
  assert.deepEqual(list[1], { seq: 9, at: iso(NOW) }, 'gelecek tarihli head saati şimdiye kırpılır');
});

test('giden: yayından sonra sync yapan eşlerin hiçbiri görmediyse takılma alarmı', () => {
  const publications = [{ seq: 40, at: iso(NOW - 90 * MIN) }];
  const result = guard.assessTransport({ deviceId: 'me', publications, now: NOW,
    beacons: [beacon('p1', { updatedAt: iso(NOW - 5 * MIN), seen: { me: 30 } }), beacon('p2', { updatedAt: iso(NOW - 10 * MIN), seen: { me: 39 } })] });
  assert.equal(result.outbound.status, 'stalled');
  assert.equal(result.outbound.seq, 40);
  assert.equal(result.alert, true);
  assert.match(result.key, /^out:40$/);
});

test('giden: tek bir eş bile gördüyse yükleme çalışıyor (eşin kendi indirme sorunu bana alarm değildir)', () => {
  const result = guard.assessTransport({ deviceId: 'me', publications: [{ seq: 40, at: iso(NOW - 90 * MIN) }], now: NOW,
    beacons: [beacon('p1', { seen: { me: 30 } }), beacon('p2', { seen: { me: 40 } })] });
  assert.equal(result.outbound.status, 'ok');
  assert.equal(result.alert, false);
});

test('giden: kanıt yoksa karar yok — yeni yayın, yayından önce sync yapan eş, eski sürüm eş', () => {
  const fresh = guard.assessTransport({ deviceId: 'me', publications: [{ seq: 40, at: iso(NOW - 5 * MIN) }], now: NOW, beacons: [beacon('p1')] });
  assert.equal(fresh.outbound.status, 'unknown', 'LAG dolmadan karar verilmez');
  const idle = guard.assessTransport({ deviceId: 'me', publications: [{ seq: 40, at: iso(NOW - 90 * MIN) }], now: NOW,
    beacons: [beacon('p1', { updatedAt: iso(NOW - 80 * MIN) })] });
  assert.equal(idle.outbound.status, 'unknown', 'yayından sonra yeterince geç sync yapmamış eş kanıt değildir');
  const legacy = guard.assessTransport({ deviceId: 'me', publications: [{ seq: 40, at: iso(NOW - 90 * MIN) }], now: NOW,
    beacons: [{ schemaVersion: 1, deviceId: 'old', updatedAt: iso(NOW) }, beacon('me', { seen: {} })] });
  assert.equal(legacy.outbound.status, 'unknown', 'seen haritası olmayan işaret ve kendi işaretim karar dışıdır');
  assert.equal(legacy.alert, false);
});

test('gelen: üçüncü cihaz görmüş, ben LAG sonra sync yapmama rağmen görmediysem indirme takılmış', () => {
  const beacons = [
    beacon('p1', { latestPublishedSeq: 70, publishedAt: iso(NOW - 120 * MIN) }),
    beacon('p2', { seen: { p1: 70 } }),
  ];
  const result = guard.assessTransport({ deviceId: 'me', publications: [], beacons, localSeen: { p1: 60 }, lastSyncAt: iso(NOW - MIN), now: NOW });
  assert.equal(result.inbound.status, 'stalled');
  assert.equal(result.inbound.peers[0].deviceId, 'p1');
  assert.equal(result.inbound.peers[0].witness, 'p2');
  assert.equal(result.alert, true);
});

test('gelen: tanık yoksa yalnız şüpheli (alarm yok); son sync eskiyse değerlendirme yok', () => {
  const beacons = [beacon('p1', { latestPublishedSeq: 70, publishedAt: iso(NOW - 120 * MIN) })];
  const suspect = guard.assessTransport({ deviceId: 'me', beacons, localSeen: { p1: 60 }, lastSyncAt: iso(NOW - MIN), now: NOW });
  assert.equal(suspect.inbound.status, 'suspect');
  assert.equal(suspect.alert, false);
  const stale = guard.assessTransport({ deviceId: 'me', beacons: [...beacons, beacon('p2', { seen: { p1: 70 } })], localSeen: { p1: 60 }, lastSyncAt: iso(NOW - 110 * MIN), now: NOW });
  assert.equal(stale.inbound.status, 'unknown', 'bu cihaz yayından sonra sync yapmadıysa OneDrive suçlanmaz');
  const ok = guard.assessTransport({ deviceId: 'me', beacons, localSeen: { p1: 70 }, lastSyncAt: iso(NOW - MIN), now: NOW });
  assert.equal(ok.inbound.status, 'ok');
});

test('afterSync: işareti ortak klasöre yazar, yerel yayın kaydını tutar ve eşleri okur', async () => {
  const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'bl-transport-'));
  try {
    const local = path.join(tmp, 'local'), syncRoot = path.join(tmp, 'hub', 'BUYER_LOG_SYNC');
    const writeJson = async (file, value) => { await fsp.mkdir(path.dirname(file), { recursive: true }); await fsp.writeFile(file, JSON.stringify(value)); };
    const transport = path.join(syncRoot, guard.TRANSPORT_DIR);
    await writeJson(path.join(transport, 'peer%2F1.json'), beacon('peer/1', { seen: { 'me/1': 3 } }));
    await writeJson(path.join(transport, 'wrong-name.json'), beacon('someone'));
    await fsp.writeFile(path.join(transport, 'broken.json'), '{');
    const instance = guard.createSyncTransportGuard({ localDataRoot: local, writeJson });
    const result = await instance.afterSync({ syncRoot, deviceId: 'me/1', now: NOW - 60 * MIN,
      state: { syncCheckpoints: { 'peer/1': 8 } }, head: { latestSequence: 5, updatedAt: iso(NOW - 60 * MIN) }, lastSyncAt: iso(NOW - 60 * MIN) });
    const own = JSON.parse(await fsp.readFile(path.join(transport, 'me%2F1.json'), 'utf8'));
    assert.equal(own.latestPublishedSeq, 5);
    assert.deepEqual(own.seen, { 'peer/1': 8 });
    assert.deepEqual(instance.readLocal().publications, [{ seq: 5, at: iso(NOW - 60 * MIN) }]);
    assert.equal(result.peerCount, 1, 'adı kimliğiyle eşleşmeyen veya bozuk işaret okunmaz');
    const later = await instance.afterSync({ syncRoot, deviceId: 'me/1', now: NOW, state: {}, head: { latestSequence: 5 }, lastSyncAt: iso(NOW) });
    assert.equal(later.outbound.status, 'stalled', 'eş yayından 60 dk sonra sync yaptı ama 5\'i görmedi');
  } finally { await fsp.rm(tmp, { recursive: true, force: true }); }
});

function fakeWindows({ running = true, files = [], registry = '' } = {}) {
  const calls = [], launches = [];
  let state = running;
  const exec = async (file, args) => {
    calls.push([path.win32.basename(file).toLowerCase(), ...args]);
    if (/tasklist/i.test(file)) return { stdout: state ? '"OneDrive.exe","123","Console","1","90.000 K"' : 'INFO: No tasks are running which match the specified criteria.' };
    if (/reg\.exe/i.test(file)) return { stdout: registry };
    if (/onedrive\.exe/i.test(file) && args[0] === '/shutdown') { state = false; return { stdout: '' }; }
    return { stdout: '' };
  };
  const env = { SystemRoot: 'C:\\Windows', LOCALAPPDATA: 'C:\\Users\\u\\AppData\\Local', OneDriveCommercial: 'C:\\Users\\u\\OneDrive - Org' };
  const existing = new Set(files.map(file => file.toLowerCase()));
  let clock = NOW;
  const control = createOneDriveControl({ platform: 'win32', env, exec, launch: (file, args) => launches.push([file, ...args]),
    exists: file => existing.has(String(file).toLowerCase()), sleep: async () => {}, now: () => clock });
  return { control, calls, launches, advance: ms => { clock += ms; } };
}
const HUB = 'C:\\Users\\u\\OneDrive - Org\\Shared - Buyer Log\\Senkronizasyon Verileri';
const EXE = 'C:\\Users\\u\\AppData\\Local\\Microsoft\\OneDrive\\OneDrive.exe';

test('OneDrive klasör tespiti: ortam değişkeni ve kayıt defterindeki eşitlenen kitaplıklar', async () => {
  assert.ok(isInside(HUB, 'C:\\Users\\u\\OneDrive - Org'));
  assert.ok(!isInside('C:\\Users\\u\\OneDrive - Org2\\x', 'C:\\Users\\u\\OneDrive - Org'), 'önek benzerliği içeride sayılmaz');
  assert.deepEqual(parseRegistryRoots('    UserFolder    REG_SZ    C:\\Users\\u\\OneDrive - Org\r\n    x    REG_DWORD    0x1\r\n    abc    REG_SZ    D:\\Sync\\Lib\r\n'),
    ['C:\\Users\\u\\OneDrive - Org', 'D:\\Sync\\Lib']);
  const { control } = fakeWindows({ files: [EXE], registry: '    abc    REG_SZ    D:\\Sync\\Lib\r\n' });
  assert.equal((await control.detect(HUB)).managed, true);
  assert.equal((await control.detect('D:\\Sync\\Lib\\hub')).managed, true);
  assert.equal((await control.detect('\\\\server\\share\\hub')).managed, false);
  const linux = createOneDriveControl({ platform: 'linux' });
  assert.equal((await linux.detect(HUB)).supported, false);
  await assert.rejects(linux.restart(HUB), { code: 'ONEDRIVE_UNSUPPORTED_PLATFORM' });
});

test('cihazda tut: yalnız küçük senkron klasörleri, kabuksuz attrib, görsel/yedek ve kök dışı ad yok', async () => {
  const sync = `${HUB}\\BUYER_LOG_SYNC`, master = `${HUB}\\master`;
  const { control, calls } = fakeWindows({ files: [sync, master, `${HUB}\\..\\evil`] });
  const result = await control.keepOnDevice(HUB, { sync: 'BUYER_LOG_SYNC', master: 'master', business: '..\\evil', images: 'model-images' });
  assert.deepEqual(result.pinned, ['BUYER_LOG_SYNC', 'master']);
  const attrib = calls.filter(call => call[0] === 'attrib.exe');
  assert.deepEqual(attrib[0], ['attrib.exe', '+P', '-U', sync]);
  assert.deepEqual(attrib[1], ['attrib.exe', '+P', '-U', `${sync}\\*`, '/S', '/D']);
  assert.ok(!attrib.some(call => call.some(arg => /model-images|personal-backups|evil/.test(arg))));
  await assert.rejects(control.keepOnDevice('\\\\server\\share\\hub', {}), { code: 'ONEDRIVE_NOT_MANAGED' });
});

test('yeniden başlat: /shutdown → kapanış doğrulanır → /background; /reset yok, bekleme süresi var', async () => {
  const { control, calls, launches, advance } = fakeWindows({ files: [EXE] });
  const result = await control.restart(HUB);
  assert.deepEqual(result, { restarted: true, started: true });
  assert.ok(calls.some(call => call[0] === 'onedrive.exe' && call[1] === '/shutdown'));
  assert.deepEqual(launches, [[EXE, '/background']]);
  assert.ok(!calls.flat().some(arg => /reset/i.test(String(arg))));
  await assert.rejects(control.restart(HUB), { code: 'ONEDRIVE_RESTART_COOLDOWN' });
  advance(11 * MIN);
  await control.restart(HUB);
  assert.equal(launches.length, 2);
  const stopped = fakeWindows({ files: [EXE], running: false });
  assert.deepEqual(await stopped.control.restart(HUB), { restarted: false, started: true }, 'çalışmıyorsa yalnız başlatır');
  await assert.rejects(fakeWindows({ files: [] }).control.restart(HUB), { code: 'ONEDRIVE_NOT_FOUND' });
});

test('yeniden başlat: OneDrive kapanmazsa yeniden başlatma yapılmaz', async () => {
  const launches = [];
  const control = createOneDriveControl({ platform: 'win32', env: { SystemRoot: 'C:\\Windows', LOCALAPPDATA: 'C:\\L', OneDrive: 'C:\\OD' },
    exec: async file => ({ stdout: /tasklist/i.test(file) ? '"OneDrive.exe","1"' : '' }), launch: (...args) => launches.push(args),
    exists: () => true, sleep: async () => {} });
  await assert.rejects(control.restart('C:\\OD\\hub'), { code: 'ONEDRIVE_SHUTDOWN_TIMEOUT' });
  assert.equal(launches.length, 0);
});

test('Shared Hub yazma testi: zaman aşımından sonra biten yazma ortak klasörde probe dosyası bırakmaz', async () => {
  const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'bl-probe-'));
  const original = fsp.writeFile;
  try {
    const hubRoot = path.join(tmp, 'hub');
    await fsp.mkdir(hubRoot);
    const hub = createSharedHub({ localDataRoot: path.join(tmp, 'local'), networkTimeoutMs: 1000 });
    await hub.initialize(hubRoot);
    fsp.writeFile = function delayed(file, ...rest) {
      if (String(file).includes('.buyerlog-hub-probe-')) return new Promise(resolve => setTimeout(resolve, 1300)).then(() => original.call(fsp, file, ...rest));
      return original.call(fsp, file, ...rest);
    };
    await assert.rejects(hub.validate(hubRoot, { requireWrite: true }), { code: 'SHARED_HUB_TIMEOUT' });
    await new Promise(resolve => setTimeout(resolve, 800));
    assert.deepEqual(fs.readdirSync(hubRoot).filter(name => name.startsWith('.buyerlog-hub-probe-')), []);
  } finally { fsp.writeFile = original; await fsp.rm(tmp, { recursive: true, force: true }); }
});

test('Shared Hub: eski sürümlerin bıraktığı 24 saatten eski probe dosyaları temizlenir, diğerleri korunur', async () => {
  const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'bl-probe-sweep-'));
  try {
    const hub = createSharedHub({ localDataRoot: path.join(tmp, 'local') });
    const old = path.join(tmp, '.buyerlog-hub-probe-35500-2b275c65-6868-49bb-8845-2213bf701b52');
    const recent = path.join(tmp, '.buyerlog-hub-probe-1-2b275c65-6868-49bb-8845-2213bf701b53.ready');
    const foreign = path.join(tmp, '.buyerlog-hub-probe-notes.txt');
    for (const file of [old, recent, foreign]) await fsp.writeFile(file, 'ok');
    const past = new Date(Date.now() - 48 * 60 * MIN);
    await fsp.utimes(old, past, past); await fsp.utimes(foreign, past, past);
    assert.equal(await hub.removeStaleProbes(tmp), 1);
    assert.ok(!fs.existsSync(old));
    assert.ok(fs.existsSync(recent), 'yeni (başka cihazda sürmekte olabilecek) test dosyası silinmez');
    assert.ok(fs.existsSync(foreign), 'desene uymayan dosya silinmez');
    assert.equal(await hub.removeStaleProbes(tmp), 0, 'saatte en fazla bir tarama');
  } finally { await fsp.rm(tmp, { recursive: true, force: true }); }
});

test('sözleşme: sunucu bağlantısı, yerel-yalnız onaylı uç noktalar ve lazy arayüz', () => {
  const server = fs.readFileSync(path.join(ROOT, 'server', 'server.js'), 'utf8');
  const app = fs.readFileSync(path.join(ROOT, 'public', 'app-main.js'), 'utf8');
  const perf = fs.readFileSync(path.join(ROOT, 'public', 'perf-runtime.js'), 'utf8');
  const ui = fs.readFileSync(path.join(ROOT, 'public', 'sync-transport-ui.js'), 'utf8');
  assert.match(server, /try \{ await updateSyncTransport\(status, head\); \} catch \(error\) \{ logRuntimeFailure\('syncTransport', error\); \}/);
  assert.match(server, /transport:syncTransportAssessment \}/);
  for (const route of ['onedrive', 'onedrive/keep-local', 'onedrive/restart']) {
    assert.match(server, new RegExp(`app\\.(get|post)\\('/api/sync-transport/${route.replace('/', '\\/')}', userAccess\\.requireArea\\('source'\\), requireLoopback`));
  }
  assert.match(server, /req\.body && req\.body\.confirm === true/);
  assert.match(server, /if \(status\.progress\) return res\.status\(409\)/);
  assert.match(perf, /syncTransport:\['sync-transport-ui\.js\?rev=1'\]/);
  assert.match(app, /ensureFeature\?\.\('syncTransport'\)/);
  assert.match(app, /s\.transport&&s\.transport\.alert/);
  assert.doesNotMatch(app, /<script[^>]+sync-transport-ui\.js/);
  assert.match(ui, /global\.confirm\(message\)/, 'OneDrive yeniden başlatma kullanıcı onayı ister');
  assert.match(ui, /blMotionEnter/);
});

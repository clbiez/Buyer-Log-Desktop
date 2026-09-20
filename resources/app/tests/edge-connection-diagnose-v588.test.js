'use strict';

// v5.88 — "Remote debugging açık ama hâlâ bağlanmıyor".
//
// Bağlantı yalnız TEK bir profil klasöründeki DevToolsActivePort dosyasına
// bakıyordu (%LOCALAPPDATA%\Microsoft\Edge\User Data). Kullanıcının Edge'i
// Beta/Dev/Canary kanalındaysa, kurumsal kurulumda profil başka yerdeyse ya da
// Edge elle --remote-debugging-port ile başlatıldıysa dosya orada bulunmuyor ve
// remote debugging açık olmasına rağmen bağlantı kurulamıyordu.
//
// Ayrıca nerede takıldığını tahmin etmek yerine adım adım raporlayan bir
// tanılama eklendi.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const CONNECTOR = fs.readFileSync(path.join(ROOT, 'server', 'lib', 'agent-browser-connector.js'), 'utf8');
const SERVER = fs.readFileSync(path.join(ROOT, 'server', 'server.js'), 'utf8');
const AUTO = fs.readFileSync(path.join(ROOT, 'public', 'automations.js'), 'utf8');

const connector = require('../server/lib/agent-browser-connector');

test('v5.88 birden çok Edge profil klasörü aranıyor', () => {
  const list = connector.edgeUserDataDirCandidates();
  assert.ok(Array.isArray(list));
  // Windows kanalları kod içinde tanımlı olmalı.
  ['Edge Beta', 'Edge Dev', 'Edge SxS'].forEach(channel => {
    assert.ok(CONNECTOR.includes(`'${channel}'`), `${channel} adayı bulunmalı`);
  });
  // macOS ve Linux yolları da var.
  assert.match(CONNECTOR, /'Library', 'Application Support', 'Microsoft Edge'/);
  assert.match(CONNECTOR, /'\.config', 'microsoft-edge'/);
});

test('v5.88 aday listesi tekrarsız ve elle verilen klasör en önde', () => {
  const previous = process.env.BL_EDGE_USER_DATA_DIR;
  process.env.BL_EDGE_USER_DATA_DIR = '/tmp/ozel-edge-profili';
  try {
    const list = connector.edgeUserDataDirCandidates();
    assert.equal(list[0], '/tmp/ozel-edge-profili');
    assert.equal(new Set(list.map(item => item.toLowerCase())).size, list.length, 'tekrar olmamalı');
    // edgeUserDataDir listenin ilkini döndürür; iki yer ayrışmamalı.
    assert.equal(connector.edgeUserDataDir(), list[0]);
  } finally {
    if (previous == null) delete process.env.BL_EDGE_USER_DATA_DIR;
    else process.env.BL_EDGE_USER_DATA_DIR = previous;
  }
});

test('v5.88 dosya bulunamazsa yaygın portlar da deneniyor', () => {
  // Edge elle --remote-debugging-port=9222 ile açıldığında DevToolsActivePort
  // beklenen klasörde olmayabilir; port doğrudan yoklanır.
  assert.match(CONNECTOR, /const COMMON_CDP_PORTS = \[9222, 9223\]/);
  const block = CONNECTOR.slice(CONNECTOR.indexOf('async function connectExistingEdge'), CONNECTOR.indexOf('/* Bağlantı tanılaması'));
  assert.match(block, /for \(const dir of edgeUserDataDirCandidates\(\)\)/);
  assert.match(block, /for \(const port of COMMON_CDP_PORTS\)/);
  // Hangi yoldan bağlanıldığı raporlanmalı; tanılamada işe yarıyor.
  assert.match(block, /source:'devtools-active-port'/);
  assert.match(block, /source:'known-port'/);
});

test('v5.88 tanılama dört adımı da raporluyor', async () => {
  const report = await connector.diagnose();
  assert.equal(typeof report.ok, 'boolean');
  assert.deepEqual(report.checks.map(check => check.key), ['edge', 'profile', 'cdp', 'connection']);
  report.checks.forEach(check => {
    assert.equal(typeof check.ok, 'boolean');
    assert.ok(check.detail && check.detail.length > 0, `${check.key} için açıklama olmalı`);
  });
  // Profil adımı hangi klasörlere bakıldığını göstermeli — kullanıcı yanlış
  // klasöre bakıldığını ancak böyle fark edebilir.
  const profile = report.checks.find(check => check.key === 'profile');
  assert.ok(Array.isArray(profile.candidates) && profile.candidates.length > 0);
  profile.candidates.forEach(item => {
    assert.equal(typeof item.dir, 'string');
    assert.equal(typeof item.exists, 'boolean');
  });
  // Port adımı hangi portların denendiğini göstermeli.
  const cdp = report.checks.find(check => check.key === 'cdp');
  assert.ok(Array.isArray(cdp.ports) && cdp.ports.length > 0);
});

test('v5.88 bağlantı yokken tanılama başarısız ama ÇÖKMEDEN döner', async () => {
  const report = await connector.diagnose();
  // Test ortamında Edge yok; tanılama istisna atmadan sonuç üretmeli.
  assert.equal(report.ok, false);
  assert.equal(report.checks.find(check => check.key === 'connection').ok, false);
});

test('v5.88 tanılama iki ekran için de uç noktaya bağlı', () => {
  assert.match(SERVER, /\/api\/agent-platform\/browser\/diagnose/);
  assert.match(SERVER, /\/api\/automations\/browser\/diagnose/);
  // Yetki alanları status ile aynı kalmalı.
  assert.match(SERVER, /'\/api\/agent-platform\/browser\/diagnose', userAccess\.requireArea\('agents'\)/);
  assert.match(SERVER, /'\/api\/automations\/browser\/diagnose', userAccess\.requireArea\('automations'\)/);
});

test('v5.88 arayüzde tanılamayı çalıştıran düğme var', () => {
  assert.match(AUTO, /data-auto-edge-diagnose>/);
  assert.match(AUTO, /\[data-auto-edge-diagnose\]'\)\?\.addEventListener/);
  assert.match(AUTO, /\/api\/automations\/browser\/diagnose/);
});

test('v5.88 kurulum sayfası doğrudan Remote debugging bölümünü açıyor', () => {
  assert.match(CONNECTOR, /edge:\/\/inspect\/#remote-debugging/);
  assert.doesNotMatch(CONNECTOR, /edge:\/\/inspect\/#devices/);
});

test('v5.88b port sondası üç arıza durumunu ayırt ediyor', async () => {
  const http = require('node:http');
  const PORT = 9231;
  // 1) Hiç dinlenmiyor → TCP reddi. Bu, DevToolsActivePort dosyasının bayat
  //    olduğunu gösterir ve çözümü Edge'i yeniden başlatmaktır.
  const closed = await connector.cdpProbe(PORT, 600);
  assert.equal(closed.ok, false);
  assert.equal(closed.reason, 'tcp-refused');
  assert.equal(closed.listening, false);

  // 2) Port açık ama istek reddediliyor → sunucu ayakta, izin/başlık sorunu.
  //    Çözümü tamamen farklıdır; ikisini ayırmak şart.
  const refusing = http.createServer((req, res) => { res.writeHead(403); res.end('no'); });
  await new Promise(resolve => refusing.listen(PORT, '127.0.0.1', resolve));
  try {
    const probe = await connector.cdpProbe(PORT, 900);
    assert.equal(probe.ok, false);
    // v5.91: cevap veren ama DevTools olmayan sunucu artık ayrı sınıflanıyor
    // ('foreign-server'), çünkü çözümü tamamen farklı: portu başka uygulama tutuyor.
    assert.equal(probe.reason, 'foreign-server');
    assert.equal(probe.listening, true);
    /* v7.30'da GÜNCELLENDİ (silinmedi). Burası eskiden İKİ ana bilgisayar adının
       da denenmesini şart koşuyordu. Ama Edge 144+ remote debugging'e yaklaşan
       her istek için ayrı bir "Allow remote debugging?" onayı açıyor ve onay
       beklenirken yanıt tam olarak böyle "DevTools değil" görünüyor — yani bu
       ikinci istek, kullanıcının şikâyet ettiği ikinci diyaloğu açan şeydi.
       Sunucu CEVAP verdiyse orada olduğu bellidir; tek deneme yeter. Testin
       asıl amacı — üç arıza durumunu ayırt etmek — olduğu gibi korunuyor. */
    assert.deepEqual(probe.attempts.map(item => item.host), ['127.0.0.1']);
  } finally { await new Promise(resolve => refusing.close(resolve)); }

  // 2b) Port açık ama HİÇ cevap vermiyor → taşıma hatası. Bu durumda localhost
  //     yedeği hâlâ denenmeli: Chromium'un DNS yeniden bağlama koruması Host
  //     başlığına bakar ve iki ad farklı davranabilir.
  // Bağlantıyı kabul edip hemen düşürür: TCP açık görünür (tcpOpen geçer),
  // HTTP isteği ise taşıma hatasıyla biter. Soket açık bırakılmadığı için
  // test süreci de takılmaz.
  const mute = require('node:net').createServer(socket => { socket.on('error', () => {}); socket.destroy(); });
  await new Promise(resolve => mute.listen(PORT, '127.0.0.1', resolve));
  try {
    const probe = await connector.cdpProbe(PORT, 700);
    assert.equal(probe.ok, false);
    assert.equal(probe.listening, true);
    assert.deepEqual(probe.attempts.map(item => item.host), ['127.0.0.1', 'localhost'],
      'cevap alınamadıysa localhost yedeği çalışmalı');
    assert.ok(probe.attempts.every(item => item.error), 'her iki deneme de taşıma hatası vermeli');
  } finally { await new Promise(resolve => mute.close(resolve)); }

  // 3) Geçerli yanıt → bağlanılabilir.
  const ok = http.createServer((req, res) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{"Browser":"Edg/1"}'); });
  await new Promise(resolve => ok.listen(PORT, '127.0.0.1', resolve));
  try {
    const probe = await connector.cdpProbe(PORT, 900);
    assert.equal(probe.ok, true);
    assert.equal(probe.host, '127.0.0.1');
    assert.equal(await connector.cdpReady(PORT, 900), true);
  } finally { await new Promise(resolve => ok.close(resolve)); }
});

test('v5.88b tanılama bayat DevToolsActivePort dosyasını ayırt ediyor', async () => {
  const report = await connector.diagnose();
  const cdp = report.checks.find(check => check.key === 'cdp');
  // Port dinlenmiyorsa açıklama "dosya önceki oturumdan kalma" olasılığını
  // söylemeli — kullanıcının bildirdiği durum tam olarak buydu.
  assert.match(cdp.detail, /dinlenmiyor|cevap veriyor|reddediyor/);
  // Dosyanın ne zaman yazıldığı da raporlanır: bayatlığı gösteren en net kanıt.
  const profile = report.checks.find(check => check.key === 'profile');
  profile.candidates.forEach(item => {
    assert.ok(Object.prototype.hasOwnProperty.call(item, 'writtenAt'));
  });
});

test('v5.91 DevTools olmayan bir sunucu "bağlandı" sayılmaz', async () => {
  // Kullanıcının durumu: port 9222 AÇIK ama /json/version 404 dönüyor.
  // Sadece response.ok'a bakmak yetmez; yanıtın gerçekten DevTools olduğu
  // doğrulanmalı, yoksa portu tutan başka bir uygulamaya bağlanmaya çalışırdık.
  const http = require('node:http');
  const PORT = 9242;
  const foreign = http.createServer((req, res) => { res.writeHead(404, { Server: 'BaskaUygulama/1.0' }); res.end('Not Found'); });
  await new Promise(resolve => foreign.listen(PORT, '127.0.0.1', resolve));
  try {
    const probe = await connector.cdpProbe(PORT, 900);
    assert.equal(probe.ok, false);
    assert.equal(probe.reason, 'foreign-server');
    assert.equal(probe.listening, true);
    // Portu kimin tuttuğunu anlamaya yarayan ipuçları raporlanmalı.
    const first = probe.attempts[0];
    assert.equal(first.status, 404);
    assert.equal(first.server, 'BaskaUygulama/1.0');
    assert.match(first.body, /Not Found/);
  } finally { await new Promise(resolve => foreign.close(resolve)); }

  // 200 dönen ama DevTools olmayan bir sunucu da kabul edilmemeli.
  const impostor = http.createServer((req, res) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{"hello":"world"}'); });
  await new Promise(resolve => impostor.listen(PORT, '127.0.0.1', resolve));
  try {
    const probe = await connector.cdpProbe(PORT, 900);
    assert.equal(probe.ok, false, '200 tek başına yeterli değil');
    assert.equal(probe.reason, 'foreign-server');
  } finally { await new Promise(resolve => impostor.close(resolve)); }
});

test('v5.91 gerçek DevTools yanıtı tanınıyor', async () => {
  const http = require('node:http');
  const PORT = 9243;
  const real = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ Browser: 'Edg/140.0', webSocketDebuggerUrl: 'ws://127.0.0.1/devtools/browser/x' }));
  });
  await new Promise(resolve => real.listen(PORT, '127.0.0.1', resolve));
  try {
    const probe = await connector.cdpProbe(PORT, 900);
    assert.equal(probe.ok, true);
    assert.equal(probe.browser, 'Edg/140.0');
  } finally { await new Promise(resolve => real.close(resolve)); }
  assert.equal(connector.looksLikeDevTools({ Browser: 'Edg/1' }), true);
  assert.equal(connector.looksLikeDevTools({ webSocketDebuggerUrl: 'ws://x' }), true);
  assert.equal(connector.looksLikeDevTools({ hello: 'world' }), false);
  assert.equal(connector.looksLikeDevTools(null), false);
});

test('v5.91 HTTP uçları kapalıysa tarayıcı WebSocket adresi deneniyor', async () => {
  // Edge remote debugging'i kutucukla açtığında /json/* uçlarını sunmayabiliyor;
  // o durumda tek giriş DevToolsActivePort dosyasının ikinci satırındaki
  // tarayıcı WebSocket yoludur.
  const net = require('node:net');
  const PORT = 9244;
  const upgrading = net.createServer(socket => {
    socket.once('data', () => socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\n\r\n'));
  });
  await new Promise(resolve => upgrading.listen(PORT, '127.0.0.1', resolve));
  try {
    assert.equal(await connector.cdpWebSocketReady(PORT, '/devtools/browser/abc', 1000), true);
    // Yol yoksa denenmemeli.
    assert.equal(await connector.cdpWebSocketReady(PORT, '', 1000), false);
  } finally { await new Promise(resolve => upgrading.close(resolve)); }

  // 101 dönmeyen sunucu kabul edilmemeli.
  const refusing = net.createServer(socket => {
    socket.once('data', () => { socket.write('HTTP/1.1 404 Not Found\r\n\r\n'); socket.end(); });
  });
  await new Promise(resolve => refusing.listen(PORT, '127.0.0.1', resolve));
  try {
    assert.equal(await connector.cdpWebSocketReady(PORT, '/devtools/browser/abc', 1000), false);
  } finally { await new Promise(resolve => refusing.close(resolve)); }
});

test('v5.91 ws yoluyla kurulan bağlantı ws:// adresi döndürüyor', () => {
  const CONNECTOR2 = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'server', 'lib', 'agent-browser-connector.js'), 'utf8');
  assert.match(CONNECTOR2, /source:'devtools-websocket'/);
  assert.match(CONNECTOR2, /endpoint:`ws:\/\/127\.0\.0\.1:\$\{active\.port\}\$\{active\.browserPath\}`/);
});

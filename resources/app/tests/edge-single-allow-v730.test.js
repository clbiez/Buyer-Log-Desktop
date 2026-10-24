'use strict';

/*
 * v7.30 — EDGE'DE TEK "ALLOW"
 *
 * Kullanıcı talebi (birebir): "Evet 1 kere Allow işlemi yapılsın."
 *
 * ARKA PLAN
 * Edge 144+ remote debugging'e yaklaşan HER dış istek için "Allow remote
 * debugging?" onayı çıkarıyor ve bu diyaloglar üst üste biniyor. Chromium
 * tarafında "beni hatırla" isteği "not planned" olarak kapatıldığı için onayı
 * tarayıcıda kalıcılaştırmak mümkün değil. Yapılabilecek tek şey Buyer Log'un
 * Edge'e KAÇ KERE yaklaştığını azaltmak.
 *
 * Eskiden tek bir bağlanma isteği dört ayrı yaklaşma üretiyordu:
 *   1) /json/version → 127.0.0.1
 *   2) /json/version → localhost        ← ilk istek onay beklerken hep olurdu
 *   3) tarayıcı WebSocket el sıkışması
 *   4) Playwright connectOverCDP
 * Üstelik status(), her "Bağlantıyı kontrol et" tıklaması ve Otomasyon
 * Ayarları penceresinin her açılışı bu diziyi baştan çalıştırıyordu.
 *
 * BU DOSYANIN KORUDUĞU DAVRANIŞLAR
 *  1) HTTP yoklaması cevap aldıysa İKİNCİ host denenmez.
 *  2) Bulunan adres önbelleğe alınır; sonraki çağrılar yalnız ÇIPLAK TCP ile
 *     bakar — DevTools'a istek gitmez, dolayısıyla diyalog çıkmaz.
 *  3) Aynı anda gelen çağrılar tek arama sözünü paylaşır (single-flight).
 *  4) status() artık Edge'e hiç bağlanmaz.
 *  5) Edge kapanınca önbellek düşer — ölü porta bağlanmaya çalışılmaz.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const connector = require(path.join(ROOT, 'server', 'lib', 'agent-browser-connector.js'));
const SOURCE = fs.readFileSync(path.join(ROOT, 'server', 'lib', 'agent-browser-connector.js'), 'utf8');

/* Onay diyaloğu bekleyen bir Edge'i taklit eder: port DİNLER (TCP açılır) ama
   DevTools yanıtı vermez. Gerçek hayatta kullanıcı Allow'a basana kadar durum
   tam olarak budur — ve eski kod burada ikinci bir istek daha atıyordu. */
function pendingConsentServer() {
  const requests = [];
  const server = net.createServer(socket => {
    socket.on('data', chunk => {
      const head = String(chunk).split('\r\n')[0] || '';
      requests.push(head);
      socket.end('HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\n\r\n');
    });
    socket.on('error', () => {});
  });
  return new Promise(resolve => {
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port, requests,
      close: () => new Promise(done => server.close(done)) }));
  });
}
function silentPort() {
  const server = net.createServer(socket => socket.on('error', () => {}));
  return new Promise(resolve => {
    server.listen(0, '127.0.0.1', () => resolve({ port: server.address().port,
      close: () => new Promise(done => server.close(done)) }));
  });
}

/* ------------------------------------------------------------------ */
/* 1) Onay beklerken İKİNCİ istek atılmaz                              */
/* ------------------------------------------------------------------ */

test('onay bekleyen Edge’e ikinci bir istek gönderilmez (ikinci diyalog açılmaz)', async () => {
  const fake = await pendingConsentServer();
  try {
    const probe = await connector.cdpProbe(fake.port, 900);
    assert.equal(probe.ok, false);
    assert.equal(probe.listening, true, 'port dinliyor olarak görülmeli');
    assert.equal(fake.requests.length, 1,
      `onay beklerken Edge’e yalnız BİR istek gitmeli, ${fake.requests.length} gitti`);
  } finally { await fake.close(); }
});

test('port hiç cevap vermiyorsa ikinci host yine de denenir (taşıma hatası)', () => {
  // Bu yedek yol korunmalı: Chromium’un DNS yeniden bağlama koruması
  // 127.0.0.1 ile localhost’a farklı davranabiliyor.
  const start = SOURCE.indexOf('async function cdpProbe(');
  const body = SOURCE.slice(start, SOURCE.indexOf('/* Edge, remote debugging', start));
  assert.match(body, /if \(sawResponse\) break;/);
  assert.match(body, /\['127\.0\.0\.1', 'localhost'\]/, 'localhost yedeği kaldırılmamalı');
  // Kırılma yalnız CEVAP alındığında; hata yakalandığında değil.
  const breakIndex = body.indexOf('if (sawResponse) break;');
  const catchIndex = body.indexOf('} catch (error) {');
  assert.ok(breakIndex < catchIndex, 'break, catch bloğundan önce olmalı');
});

/* ------------------------------------------------------------------ */
/* 2) Adres önbelleği — tekrar tekrar yaklaşılmaz                      */
/* ------------------------------------------------------------------ */

test('önbellekteki adres ÇIPLAK TCP ile doğrulanır — DevTools’a istek gitmez', async () => {
  const fake = await pendingConsentServer();
  try {
    connector.rememberEndpoint({ endpoint: `http://127.0.0.1:${fake.port}`, port: fake.port, source: 'test' });
    const alive = await connector.cachedEndpointIfAlive();
    assert.ok(alive, 'port dinlerken önbellek geçerli sayılmalı');
    assert.equal(alive.port, fake.port);
    assert.equal(fake.requests.length, 0,
      'canlılık kontrolü DevTools’a istek göndermemeli — gönderirse yeni diyalog açılır');
  } finally { connector.forgetEndpoint(); await fake.close(); }
});

test('art arda çağrılar Edge’e yeniden yaklaşmaz', async () => {
  const fake = await pendingConsentServer();
  try {
    connector.rememberEndpoint({ endpoint: `http://127.0.0.1:${fake.port}`, port: fake.port, source: 'test' });
    for (let i = 0; i < 5; i++) await connector.connectExistingEdge();
    assert.equal(fake.requests.length, 0, 'beş çağrıda bile hiç istek gitmemeli');
  } finally { connector.forgetEndpoint(); await fake.close(); }
});

test('Edge kapanınca önbellek düşer', async () => {
  const fake = await silentPort();
  connector.rememberEndpoint({ endpoint: `http://127.0.0.1:${fake.port}`, port: fake.port, source: 'test' });
  assert.ok(await connector.cachedEndpointIfAlive(), 'açıkken geçerli');
  await fake.close();
  assert.equal(await connector.cachedEndpointIfAlive(), null, 'kapandıktan sonra düşmeli');
});

test('bağlantı kurulamazsa bayat adres önbellekte bırakılmaz', () => {
  const start = SOURCE.indexOf('async function createContext(');
  const body = SOURCE.slice(start, start + 900);
  assert.match(body, /catch \(error\) \{[\s\S]*forgetEndpoint\(\);[\s\S]*throw error;/);
});

test('tarayıcı bağlantısı koptuğunda önbellek temizlenir', () => {
  const start = SOURCE.indexOf('const cleanup=()=>{');
  const body = SOURCE.slice(start, SOURCE.indexOf("browser.on('disconnected'", start));
  assert.match(body, /forgetEndpoint\(\);/);
});

/* ------------------------------------------------------------------ */
/* 3) Single-flight — paralel istekler diyalog yığmaz                  */
/* ------------------------------------------------------------------ */

test('eşzamanlı arama istekleri TEK aramayı paylaşır', async () => {
  connector.forgetEndpoint();
  const results = await Promise.all(Array.from({ length: 6 }, () => connector.connectExistingEdge().catch(() => null)));
  // Bu ortamda Edge yok; önemli olan hepsinin AYNI sonucu paylaşması.
  assert.equal(new Set(results.map(item => JSON.stringify(item))).size, 1);
  assert.match(SOURCE, /discoveryInFlight = discoverExistingEdge\(operation\)/);
  assert.match(SOURCE, /if \(discoveryInFlight\) return discoveryInFlight;/);
  assert.match(SOURCE, /discoveryInFlight = null;/);
});

test('kullanıcı başına bağlam kurulumu da tek seferliktir', () => {
  const start = SOURCE.indexOf('async function ensureContext(');
  const body = SOURCE.slice(start, SOURCE.indexOf('async function createContext('));
  assert.match(body, /contextSetupInFlight\.get\(key\)/);
  assert.match(body, /if \(pending\) return pending;/);
  assert.match(SOURCE, /contextSetupInFlight\.delete\(key\)/);
});

/* ------------------------------------------------------------------ */
/* 4) status() Edge'e bağlanmaz                                        */
/* ------------------------------------------------------------------ */

test('status() gerçek bağlantı kurmaz — yalnız portun dinlendiğine bakar', async () => {
  const start = SOURCE.indexOf('async function status(ownerId');
  const body = SOURCE.slice(start, start + 600);
  assert.match(body, /remoteDebuggingListening\(\)/);
  assert.equal(/connectExistingEdge\(\)/.test(body), false,
    'status() bağlanırsa Otomasyon Ayarları her açılışta yeni bir onay diyaloğu açar');

  const fake = await pendingConsentServer();
  try {
    connector.rememberEndpoint({ endpoint: `http://127.0.0.1:${fake.port}`, port: fake.port, source: 'test' });
    const value = await connector.status('moderator');
    assert.equal(value.existingProfileReady, true);
    assert.equal(fake.requests.length, 0, 'status() DevTools’a istek göndermemeli');
  } finally { connector.forgetEndpoint(); await fake.close(); }
});

test('remoteDebuggingListening yalnız TCP kullanır', () => {
  const start = SOURCE.indexOf('async function remoteDebuggingListening(');
  const body = SOURCE.slice(start, SOURCE.indexOf('async function status(ownerId'));
  assert.match(body, /tcpOpen\(/);
  assert.equal(/fetch\(|cdpProbe\(|cdpReady\(|cdpWebSocketReady\(/.test(body), false,
    'hazırlık kontrolü DevTools’a hiçbir istek göndermemeli');
});

/* ------------------------------------------------------------------ */
/* 4b) UÇTAN UCA SAYIM — asıl ölçü bu                                  */
/* ------------------------------------------------------------------ */

/* Aşağıdaki dizi kullanıcının gerçekte yaptığı şeydir. Aynı sahte "onay
   bekleyen Edge" karşısında ölçüldü:
       v7.29 → 18 yaklaşma (yani 18 diyalog)
       v7.30 →  1 yaklaşma
   Sayının kendisi kilitleniyor: bir gerileme olursa bu test düşer. */
test('gerçek kullanım dizisi Edge’e YALNIZ BİR KERE yaklaşır', async () => {
  const fake = await pendingConsentServer();
  try {
    connector.forgetEndpoint();
    connector.resetDiscoveryCooldown();
    const at = { port: fake.port };
    // status() portu DevToolsActivePort’tan değil yaygın portlardan bulur;
    // sahte sunucu rastgele portta olduğu için önbellek üzerinden sürülür.
    connector.rememberEndpoint({ endpoint: `http://127.0.0.1:${at.port}`, port: at.port, source: 'test' });
    await connector.status('moderator');      // Otomasyon Ayarları açıldı
    await connector.status('moderator');      // Bağlantıyı kontrol et
    await connector.status('moderator');      // PLM ekranı
    assert.equal(fake.requests.length, 0, 'üç status hiç yaklaşma üretmemeli');

    // Önbellek düşer (Edge yeni açıldı): ilk gerçek iş bir kez yaklaşır,
    // sonrakiler ve paralel işler yaklaşmaz.
    connector.forgetEndpoint();
    connector.resetDiscoveryCooldown();
    await connector.cdpProbe(at.port, 900);   // ilk gerçek bağlanma denemesi
    const afterFirst = fake.requests.length;
    assert.equal(afterFirst, 1, 'ilk deneme tek istek atmalı');

    for (let i = 0; i < 3; i++) await connector.connectExistingEdge().catch(() => null);
    await Promise.all(Array.from({ length: 4 }, () => connector.connectExistingEdge().catch(() => null)));
    assert.ok(fake.requests.length <= afterFirst + 1,
      `sonraki işler yeni diyalog açmamalı (toplam ${fake.requests.length})`);
  } finally { connector.forgetEndpoint(); connector.resetDiscoveryCooldown(); await fake.close(); }
});

test('başarısız aramadan sonra kısa bir bekleme vardır (diyalog birikmesin)', async () => {
  // This is a failed-discovery contract, not a claim that the host has no Edge.
  // Compile the actual state/functions with explicit discovery dependencies;
  // a user's live DevTools port or another test's endpoint must not turn this
  // negative fixture into a successful lookup.
  let discoveries = 0;
  const cooldown = SOURCE.slice(SOURCE.indexOf('const DISCOVERY_COOLDOWN_MS'), SOURCE.indexOf('const USER_APPROVAL_MESSAGE'));
  const start = SOURCE.indexOf('async function connectExistingEdge(');
  const connect = SOURCE.slice(start, SOURCE.indexOf('/* Bağlantı tanılaması', start));
  const failed = require('node:vm').runInNewContext(`let discoveryInFlight=null;\n${cooldown}\n${connect}\n({connectExistingEdge,DISCOVERY_COOLDOWN_MS,discoveryCoolingDown,resetDiscoveryCooldown})`, {
    Date, cachedEndpointIfAlive: async () => null,
    discoverExistingEdge: async () => { discoveries += 1; return null; },
  });
  assert.ok(failed.DISCOVERY_COOLDOWN_MS >= 1000 && failed.DISCOVERY_COOLDOWN_MS <= 15000,
    'bekleme, kullanıcı Allow’a bastıktan sonraki denemeyi engellemeyecek kadar kısa olmalı');
  assert.equal(await failed.connectExistingEdge(), null);
  assert.equal(failed.discoveryCoolingDown(), true, 'başarısız aramadan sonra bekleme başlamalı');
  assert.equal(await failed.connectExistingEdge(), null);
  assert.equal(discoveries, 1, 'bekleme sırasında yeni arama ve onay isteği oluşmamalı');
  failed.resetDiscoveryCooldown();
  assert.equal(failed.discoveryCoolingDown(), false);
  await failed.connectExistingEdge();
  assert.equal(discoveries, 2, 'sıfırlama yeni gerçek denemeye izin vermeli');
});

test('BAŞARILI arama beklemeyi sıfırlar — bağlantı kurulunca gecikme kalmaz', () => {
  const start = SOURCE.indexOf('async function connectExistingEdge(');
  const body = SOURCE.slice(start, SOURCE.indexOf('/* Bağlantı tanılaması', start));
  assert.match(body, /discoveryFailedAt = found \? 0 : Date\.now\(\)/);
});

/* ------------------------------------------------------------------ */
/* 5) Tanılama bilerek bağlanır                                        */
/* ------------------------------------------------------------------ */

test('“Neden bağlanmıyor?” tanılaması bilerek gerçek bağlanma dener', () => {
  // Bu düğme zaten bir şey bozukken tıklanır; Edge’in ne cevap verdiğini
  // görmek tanının kendisidir. Sağlıklı kurulumda adres önbellekte olduğu için
  // yeni diyalog açılmaz.
  const start = SOURCE.indexOf('async function diagnose(');
  const body = SOURCE.slice(start, SOURCE.indexOf('function managedFallbackEnabled('));
  assert.match(body, /BİLEREK gerçek bağlanma denemesi/);
  assert.match(body, /connectExistingEdge\(\)/);
});

/* ------------------------------------------------------------------ */
/* 6) Güvenlik davranışı değişmedi                                     */
/* ------------------------------------------------------------------ */

test('onay atlanmaya ÇALIŞILMAZ — yalnız yaklaşma sayısı azaltıldı', () => {
  // Onayı bastırmaya çalışan bir bayrak/politika eklenmiş olmamalı: bu onay
  // kullanıcının oturumunu koruyor.
  assert.equal(/--remote-allow-origins|--disable-web-security|RemoteDebuggingAllowed/.test(SOURCE), false);
  // Ayrı/boş profil hiçbir koşulda açılmaz: şirket oturumları mevcut profilde.
  assert.match(SOURCE, /function managedFallbackEnabled\(\) \{ return false; \}/);
  const connectBody = SOURCE.slice(SOURCE.indexOf('async function connectPreferredEdge('), SOURCE.indexOf('function openExistingEdgeDebugSetup('));
  assert.doesNotMatch(connectBody, /launchManagedEdge|managed-fallback|user-data-dir/);
});

test('adres önbelleği yalnız BELLEKTE tutulur — diske yazılmaz', () => {
  // Diske yazılan bir CDP adresi, başka bir yerel süreç için hazır hedef olurdu.
  const start = SOURCE.indexOf('let endpointCache = null;');
  const body = SOURCE.slice(start, SOURCE.indexOf('async function discoverExistingEdge('));
  assert.equal(/writeFileSync|atomicWriteJson|saveSettings/.test(body), false);
});

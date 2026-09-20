'use strict';

/* v6.44 — CANLI SENKRONİZASYON (Server-Sent Events).
 *
 * Kullanıcı kararları:
 *   · Ekip çapında (tüm bağlı kullanıcılar arasında, yalnız kendi sekmeleri değil)
 *   · Sessizce arka planda otomatik yenileme (onay istenmez)
 *   · Yalnız hücre/override değişiklikleri (CP, Koleksiyon) — ASAS/IAS kaynak
 *     yenilemesi bu kapsamda DEĞİL.
 *
 * Kritik güvence: bu özellik v6.34'te CP için kurulan "yenileme öncesi açık
 * düzenleyiciyi kapat, bekleyen yazmaları bitir" korumasını YENİDEN AÇMAMALI.
 * Uzaktan gelen bir SSE olayı, mevcut korumalı yolları (loadFromServer /
 * commitActiveTableEditor + Koleksiyon'un kendi settle fonksiyonu) kullanmalı.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const liveEvents = require(path.join(ROOT, 'server', 'lib', 'live-events.js'));
const SERVER = fs.readFileSync(path.join(ROOT, 'server', 'server.js'), 'utf8');
const APP = fs.readFileSync(path.join(ROOT, 'public', 'app-main.js'), 'utf8');
const OVERRIDE_SYNC = fs.readFileSync(path.join(ROOT, 'public', 'override-sync.js'), 'utf8');
const INDEX = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');

function bodyOf(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `${name} bulunmalı`);
  let paren = 0, i = source.indexOf('(', start);
  for (; i < source.length; i++) {
    if (source[i] === '(') paren++;
    else if (source[i] === ')' && --paren === 0) break;
  }
  const open = source.indexOf('{', i);
  let depth = 0;
  for (let j = open; j < source.length; j++) {
    if (source[j] === '{') depth++;
    else if (source[j] === '}' && --depth === 0) return source.slice(open + 1, j);
  }
  throw new Error(`${name} ayrıştırılamadı`);
}

/* ------------------------------------------------------- 1) THROTTLE / BUS */

test('v6.44 hızlı ardışık değişiklikler tek olayda birleşiyor', async () => {
  const received = [];
  const entry = liveEvents.addClient({ write: (c) => received.push(c) }, 'B');
  liveEvents.notifyChange('orders', 'A', {});
  liveEvents.notifyChange('orders', 'A', {});
  liveEvents.notifyChange('orders', 'A', {});
  await new Promise((r) => setTimeout(r, 2700));
  liveEvents.removeClient(entry);
  assert.equal(received.length, 1, 'kısa sürede gelen üç değişiklik tek olayda birleşmeli');
  assert.match(received[0], /"area":"orders"/);
});

test('v6.44 farklı kaynaklardan birleşen olayda origin null olur', async () => {
  // Bu önemli: origin yanlışlıkla bir kaynağa sabitlenirse, o kaynağın
  // sekmesi kendi event'i sanıp gerçek bir değişikliği YOK SAYAR.
  const received = [];
  const entry = liveEvents.addClient({ write: (c) => received.push(c) }, 'B');
  liveEvents.notifyChange('orders', 'A', {});
  liveEvents.notifyChange('orders', 'C', {});
  await new Promise((r) => setTimeout(r, 2700));
  liveEvents.removeClient(entry);
  assert.match(received[0], /"originClientId":null/);
});

test('v6.44 collection alanı ownerId bazında ayrı kanallarda birikiyor', async () => {
  // Bir workspace'teki değişiklik başka bir workspace'in olayını ERKEN
  // tetiklememeli; her ownerId kendi throttle penceresine sahip olmalı.
  const received = [];
  const entry = liveEvents.addClient({ write: (c) => received.push(c) }, 'B');
  liveEvents.notifyChange('collection', 'A', { ownerId: 'ws1' });
  liveEvents.notifyChange('collection', 'A', { ownerId: 'ws2' });
  await new Promise((r) => setTimeout(r, 2700));
  liveEvents.removeClient(entry);
  assert.equal(received.length, 2, 'iki farklı workspace iki ayrı olay üretmeli');
  const owners = received.map((r) => JSON.parse(r.replace(/^data: /, '').trim()).ownerId).sort();
  assert.deepEqual(owners, ['ws1', 'ws2']);
});

test('v6.44 kaldırılan istemciye olay gönderilmiyor', async () => {
  const received = [];
  const entry = liveEvents.addClient({ write: (c) => received.push(c) }, 'B');
  liveEvents.removeClient(entry);
  liveEvents.notifyChange('orders', 'A', {});
  await new Promise((r) => setTimeout(r, 2700));
  assert.equal(received.length, 0, 'bağlantısı kapanan istemciye yazma denenmemeli');
});

test('v6.44 write hata verirse süreç çökmüyor', async () => {
  // Bağlantı zaten koptuysa res.write hata fırlatabilir; bu sessizce
  // yutulmalı, diğer istemcileri etkilememeli.
  const broken = liveEvents.addClient({ write: () => { throw new Error('ECONNRESET'); } }, 'X');
  const received = [];
  const ok = liveEvents.addClient({ write: (c) => received.push(c) }, 'Y');
  assert.doesNotThrow(() => liveEvents.notifyChange('orders', 'A', {}));
  await new Promise((r) => setTimeout(r, 2700));
  liveEvents.removeClient(broken);
  liveEvents.removeClient(ok);
  assert.equal(received.length, 1, 'sağlıklı istemci yine de olayı almalı');
});

/* --------------------------------------------------------- 2) SUNUCU UÇLARI */

test('v6.44 SSE ucu doğru başlıklarla akış açıyor', () => {
  assert.match(SERVER, /app\.get\('\/api\/live-events', \(req, res\) => \{/);
  const block = SERVER.slice(SERVER.indexOf("app.get('/api/live-events'"));
  assert.match(block.slice(0, 800), /'Content-Type': 'text\/event-stream'/);
  // v7.19: abone kaydı artık isteği de saklıyor (yayın anında oturum profilini
  // taze çözmek için). Çivilenen şey aynı: uç, istemciyi kendi clientId'siyle
  // kaydetmeli — kaydetmezse "kendi yazdığını kendine yansıtma" koruması düşer.
  assert.match(block.slice(0, 1400), /liveEvents\.addClient\(res, String\(req\.query\.clientId \|\| ''\)/);
  // Bağlantı kapanınca istemci kaydı temizlenmeli, yoksa hayalet istemcilere
  // sonsuza kadar yazmaya çalışılır.
  assert.match(block.slice(0, 1500), /req\.on\('close', \(\) => \{ clearInterval\(ping\); liveEvents\.removeClient\(entry\); \}\);/);
});

test('v6.44 üç override ucu da değişikliği yayınlıyor', () => {
  // v7.19: bildirim artık değişikliğin kendisini de taşıyor (rowPatches).
  // Çivilenen şey aynı: üç yazma ucunun ÜÇÜ de yayın yapmalı — biri unutulursa
  // o yoldan yapılan düzenleme karşı ekranlara hiç ulaşmaz.
  const matches = SERVER.match(/liveEvents\.notifyChange\('orders', requestClientId\(req\)/g) || [];
  assert.equal(matches.length, 3, 'PATCH /overrides/:orderCode, batch, batch-suppfob — üçü de yayınlamalı');
});

test('v6.44 Koleksiyon workspace kaydı ownerId ile birlikte yayınlıyor', () => {
  // v7.21: bildirim artık ownerId'nin yanında DEĞİŞEN SATIRLARI da taşıyor.
  // Çivilenen şey aynı: olay hangi workspace'in değiştiğini söylemeli, yoksa
  // başka bir sayfayı açık tutan sekmeler boşuna iş yapar.
  assert.match(SERVER, /liveEvents\.notifyChange\('collection', requestClientId\(req\), \{ ownerId/);
});

test('v6.44 clientId istekten X-Client-Id başlığıyla okunuyor', () => {
  const body = bodyOf(SERVER, 'requestClientId');
  assert.match(body, /req\.headers\['x-client-id'\]/);
});

/* --------------------------------------------------------- 3) İSTEMCİ KURULUMU */

test('v6.44 her sekme kendi kimliğini window üzerinden paylaşıyor', () => {
  assert.match(INDEX, /window\.BL_CLIENT_ID = CID;/);
});

test('v6.44 override yazmaları kendi kimliğini taşıyor', () => {
  assert.match(OVERRIDE_SYNC, /if\(typeof window!=='undefined'&&window\.BL_CLIENT_ID\)requestOpts\.headers\['X-Client-Id'\]=window\.BL_CLIENT_ID;/);
});

test('v6.44 Koleksiyon kaydı da kendi kimliğini taşıyor', () => {
  assert.match(APP, /'X-Client-Id':window\.BL_CLIENT_ID/);
});

/* ------------------------------------------------ 4) v6.34 KORUMASI KORUNUYOR */

test('v6.44 orders olayı veri kaybettirmeyen yoldan geçiyor', () => {
  // ÖZGÜN AMAÇ (v6.34/v6.44): uzaktan gelen bir değişiklik, kullanıcının o an
  // yazdığı veriyi kaybettirmemeli. O gün bunun tek yolu loadFromServer'ın
  // "düzenleyiciyi kapat → bekleyen yazmaları bitir → sonra yenile" sırasıydı,
  // bu yüzden test o çağrının şeklini çiviliyordu.
  //
  // v7.19'da mekanizma değişti: uzak değişiklik yeniden yükleme değil, satır
  // yaması olarak geliyor. Amaç aynen korunuyor ve DAHA GÜÇLÜ hâle geldi —
  // düzenlenen satır hiç ezilmiyor, yama düzenleme bitene kadar bekletiliyor.
  // Test artık çağrının şeklini değil, KORUMANIN KENDİSİNİ çiviliyor.
  const body = bodyOf(APP, 'initLiveSync');
  assert.match(body, /applyRemoteRowPatches\(payload\.rowPatches\)/, 'uzak değişiklik yama olarak uygulanmalı');
  // Tam kaynak yenilemesi bu yoldan ASLA başlatılmamalı: ekip arkadaşının
  // düzenlemesi ASAS/Antrepo verisini değiştirmez, ekranı da kilitlememeli.
  assert.doesNotMatch(body, /loadFromServer\(true/, 'canlı olay tam kaynak yenilemesi başlatmamalı');
  // Yamalanamayan yapısal değişiklikte hafif yeniden yükleme kullanılmalı.
  assert.match(body, /loadFromServer\(false\)/);
  // Düzenlenen satırın korunması ayrı fonksiyonda; burada varlığı çivilenir.
  assert.match(APP, /if\(busyRows&&busyRows\.has\(String\(row\._id\)\)\)\{hitBusyRow=true;continue;\}/);
});

test('v6.44 kendi yazdığın değişiklik kendine yenileme tetiklemiyor', () => {
  const body = bodyOf(APP, 'initLiveSync');
  assert.match(body, /if\(payload\.originClientId&&payload\.originClientId===window\.BL_CLIENT_ID\)return;/);
});

test('v6.44 Koleksiyon uzak değişikliği kullanıcının yazdığını kaybettirmiyor', () => {
  // ÖZGÜN AMAÇ (v6.34/v6.44): uzaktan gelen bir değişiklik, kullanıcının o an
  // yazdığı veriyi kaybettirmemeli. O gün bunun tek yolu "düzenleyiciyi kapat
  // → bekleyen kaydı bitir → sonra sayfayı yeniden yükle" sırasıydı, çünkü
  // gelen tek bilgi "bu sayfa değişti"ydi.
  //
  // v7.21'de mekanizma değişti: değişiklik satır yaması olarak geliyor.
  // Düzenlenen satıra HİÇ dokunulmuyor, yama düzenleme bitene kadar
  // bekletiliyor. Amaç korunuyor ve güçleniyor — artık kullanıcının açık
  // düzenleyicisini kapatmak da gerekmiyor.
  const body = bodyOf(APP, 'kolHandleRemoteChange');
  // Kendi kaydımız sürerken gelen yama, gönderilmemiş yerel düzenlemeyi ezmemeli.
  assert.match(body, /kolWorkspaceSaving\|\|kolWorkspaceSaveTimer/);
  assert.match(body, /kolApplyRemotePatches\(payload\.rowPatches\)/);
  // Düzenlenen satır atlanmalı ve yama kaybolmadan ertelenmeli.
  const apply = bodyOf(APP, 'kolApplyRemotePatches');
  assert.match(apply, /busy&&busy\.has\(id\)/, 'düzenlenen satır ezilmemeli');
  assert.match(apply, /deferred\.push\(item\)/, 'atlanan yama kaybolmamalı');
  assert.match(APP, /kolDeferredPatches=deferred/);
  assert.match(APP, /addEventListener\('focusout'[\s\S]{0,400}kolApplyRemotePatches\(pending\)/);
});

test('v6.44 Koleksiyon uzak değişikliği yalnız açık workspace eşleşirse çalışıyor', () => {
  // Başka bir workspace'in değişikliği bu sekmeyi ilgilendirmez; gereksiz
  // yenileme yapılmamalı.
  const body = bodyOf(APP, 'kolHandleRemoteChange');
  assert.match(body, /if\(!ownerId\|\|kolWorkspaceOwnerId!==ownerId\)return;/);
});

test('v6.44 Koleksiyon bekleyen debounce kaydı ATLANMADAN önce zorla bitiriliyor', () => {
  // Debounce timer'ı sadece iptal edilip kaydetmeden atlanırsa, henüz 350ms
  // dolmamış bir değişiklik SESSİZCE kaybolurdu.
  const body = bodyOf(APP, 'kolSettlePendingSave');
  assert.match(body, /clearTimeout\(kolWorkspaceSaveTimer\);kolWorkspaceSaveTimer=null;/);
  assert.match(body, /await kolSaveWorkspaceNow\(\)\.catch/);
});

test('v7.21 Koleksiyon uzak değişikliği ekranı KİLİTLEMİYOR', () => {
  /* Bu test v6.44'te tersini çiviliyordu: uzak değişiklik sırasında ekran
     salt-okunur moda düşsün isteniyordu. O günkü amaç doğruydu — kullanıcı
     birazdan değişecek veri üzerinde düzenleme yapmasın.

     Ama mekanizma sayfayı BÜTÜNÜYLE yeniden yüklemekti, dolayısıyla kilit
     şarttı. Kullanıcının saha bulgusu bunun bedelini gösterdi: "diğer
     kullanıcıların ... bildirim alması, ekran beklemesi, veri kaybı yaşaması
     istemediğim bir durum."

     v7.21'de yeniden yükleme yok; yalnız değişen satırlar yerinde
     güncelleniyor. Kilidin koruduğu risk ortadan kalktığı için kilit de
     kalkıyor. Amaç (bayat veri üzerinde düzenleme yapılmasın) artık satır
     bazında ve kesintisiz sağlanıyor. */
  const body = bodyOf(APP, 'kolHandleRemoteChange');
  assert.doesNotMatch(body, /setReadOnlyMode/, 'uzak değişiklik ekranı kilitlememeli');
  /* Her kayıtta bildirim gitmemeli: 100 kullanıcılı senaryoda bu bir sel olurdu.
     Eskiden bu "showToast hiç geçmesin" diye yazılmıştı, ama o okuma
     collection-concurrency-v721 ile çelişiyordu: orası ertelenen uzak
     değişikliğin kullanıcıdan GİZLENMEMESİNİ şart koşuyor. İkisi de haklı;
     çelişen şey granülerlikti. Kural artık: bildirim EPİZOT başına bir kez. */
  assert.match(body, /if\(!kolRemoteChangeNoticeShown\)\{/, 'bildirim koşulsuz atılmamalı');
  assert.match(body, /kolRemoteChangeNoticeShown=true;/);
  assert.match(body, /kolRemoteChangeNoticeShown=false;/, 'temize dönünce bayrak sıfırlanmalı');
  // Gövdede TEK bir bildirim olmalı ve o da bayrağı kurduktan hemen sonra.
  assert.equal((body.match(/showToast\(/g) || []).length, 1, 'gövdede tek bildirim çağrısı olmalı');
  assert.match(body, /kolRemoteChangeNoticeShown=true;\s*\n?\s*showToast\(/, 'bildirim yalnız bayrak dalının içinde olmalı');
  assert.ok(!APP.includes('This Collection page was updated by a teammate.'),
    'kayıt başına bildirim metni tamamen kaldırılmalı');
  // Görünürlük kaybolmuyor: değişen satır kısa süre vurgulanıyor.
  assert.match(APP, /kolHighlightRemoteRows/);
});

/* --------------------------------------------------------- 5) KAPSAM SINIRI */

test('v6.44 ASAS/IAS kaynak yenilemesi (performRefresh) canlı senkrona bağlanmıyor', () => {
  // Kullanıcı kararı: yalnız hücre/override değişiklikleri kapsamda; kaynak
  // yenileme kendi zamanlayıcısı ve kilidiyle çalışmaya devam eder.
  assert.doesNotMatch(SERVER, /performRefresh[\s\S]{0,400}liveEvents\.notifyChange/);
});

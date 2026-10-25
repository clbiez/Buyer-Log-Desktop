'use strict';

/*
 * v7.19 — EKİP ARKADAŞININ VERİ GİRİŞİ DİĞER EKRANLARI KİLİTLEMEZ.
 *
 * Saha bulgusu (kullanıcı): "bir kullanıcı bir veri girişi yaptığında diğer
 * kullanıcıların ekranı anlık kilitleniyor. Canlı olarak kullanıcılar arasında
 * yapılan veri girişlerinin görünür olması iyi, ancak birbirine engel olmamalı."
 *
 * Kök neden: canlı olay yalnız "orders alanında bir şey değişti" diyordu.
 * İstemci elinde başka bilgi olmadığı için TAM KAYNAK YENİLEMESİ yapıyordu
 * (loadFromServer(true,...) → /api/refresh → loadFromModels → ASAS/Antrepo
 * yeniden sorgusu + karşılaştırma + snapshot + page cache) ve bu sırada
 * setReadOnlyMode(true) ekrana "düzenleme duraklatıldı" kilidini basıyordu.
 * Tek bir not yazımı açık olan HER oturumda dakikalarca süren bir yenileme
 * başlatıyordu. Üstelik loadFromServer state.cpDirty / cpSelected /
 * ordersSelected ve geri-al yığınını sıfırladığı için kullanıcının kendi
 * çalışma durumu da siliniyordu.
 *
 * Çözüm: olay değişikliğin KENDİSİNİ taşır (mode:'patch'), istemci yalnız
 * ilgili satırları yerinde günceller. Yama olarak ifade edilemeyen yapısal
 * değişiklikte mode:'reload' gelir ve o zaman bile HAFİF yeniden yükleme
 * yapılır; tam kaynak yenilemesi hiçbir koşulda yapılmaz.
 *
 * §32: SSE tek yayın akışıdır, aboneler farklı kapsamlara sahiptir. Alan
 * değerleri her aboneye ayrı ayrı süzülerek yazılır.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const APP = fs.readFileSync(path.join(ROOT, 'public', 'app-main.js'), 'utf8');
const SERVER = fs.readFileSync(path.join(ROOT, 'server', 'server.js'), 'utf8');
const CSS = require('./helpers/manifest-css')(['ui-tokens.css','app.css','design.css','experience.css','ui-components.css'] );

// live-events tek başına yüklenebilir: HTTP sunucusu ya da veri kökü gerektirmez.
const liveEvents = require('../server/lib/live-events');

function blockOf(source, from, to) {
  const start = source.indexOf(from);
  assert.ok(start >= 0, `${from} bulunmalı`);
  const end = source.indexOf(to, start);
  assert.ok(end > start, `${to} bulunmalı`);
  return source.slice(start, end);
}

// Sahte SSE abonesi: yazılan olayları toplar.
function fakeSubscriber(name) {
  const written = [];
  const res = { write(chunk) { written.push(chunk); } };
  return {
    name, res, written,
    events() {
      return written
        .filter(line => line.startsWith('data: '))
        .map(line => JSON.parse(line.slice(6).trim()));
    },
  };
}

test.beforeEach(() => { liveEvents.setPatchAuthorizer(null); });
test.afterEach(() => { liveEvents.setPatchAuthorizer(null); });

/* ---------------- Sunucu: olayın içeriği ---------------- */

test('v7.19 aynı satırın art arda yamaları birleştirilir, sonuncusu diğerini yutmaz', () => {
  // Kullanıcı önce notu, sonra tarihi kaydederse ikisi de karşı ekrana ulaşmalı.
  const merged = liveEvents.mergeRowPatches(
    [{ orderCode: 100, patch: { model: 'M', ccode: 'C', notes: { Notes: 'ilk' } } }],
    [{ orderCode: 100, patch: { model: 'M', ccode: 'C', dates: { retailDate: '2026-09-01' } } }],
  );
  assert.equal(merged.length, 1, 'aynı satır tek yamada birleşmeli');
  assert.equal(merged[0].patch.notes.Notes, 'ilk', 'ilk turdaki not korunmalı');
  assert.equal(merged[0].patch.dates.retailDate, '2026-09-01', 'ikinci turdaki tarih eklenmeli');
});

test('v7.19 notes alt alanları birbirini ezmez', () => {
  const merged = liveEvents.mergeRowPatches(
    [{ orderCode: 1, patch: { notes: { Notes: 'ana not' } } }],
    [{ orderCode: 1, patch: { notes: { EkNot: 'ek not' } } }],
  );
  assert.deepEqual(merged[0].patch.notes, { Notes: 'ana not', EkNot: 'ek not' });
});

test('v7.19 farklı satırlar ayrı yamalar olarak kalır', () => {
  const merged = liveEvents.mergeRowPatches(
    [{ orderCode: 1, patch: { model: 'A', ccode: 'X', notes: { Notes: 'a' } } }],
    [{ orderCode: 1, patch: { model: 'B', ccode: 'X', notes: { Notes: 'b' } } }],
  );
  assert.equal(merged.length, 2, 'model farklıysa iki ayrı satırdır');
});

test('v7.19 yama olayı yalnız görebilen aboneye, yalnız görebildiği satırlarla gider', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const izinli = fakeSubscriber('kapsam-ici');
  const yasakli = fakeSubscriber('kapsam-disi');
  const a = liveEvents.addClient(izinli.res, 'c-izinli', { req: { user: 'izinli' } });
  const b = liveEvents.addClient(yasakli.res, 'c-yasakli', { req: { user: 'yasakli' } });
  // Kapsam taklidi: "izinli" yalnız 100 numaralı siparişi görebiliyor.
  liveEvents.setPatchAuthorizer((entry, patches) =>
    entry.id === 'c-izinli' ? patches.filter(item => item.orderCode === 100) : []);

  liveEvents.notifyChange('orders', 'yazan-sekme', {
    rowPatches: [
      { orderCode: 100, patch: { notes: { Notes: 'görebilir' } } },
      { orderCode: 200, patch: { suppFob: 12.5 } },
    ],
  });
  t.mock.timers.tick(3000);

  const gelen = izinli.events();
  assert.equal(gelen.length, 1, 'kapsam içindeki aboneye tek olay gitmeli');
  assert.equal(gelen[0].mode, 'patch');
  assert.equal(gelen[0].rowPatches.length, 1, 'yalnız görebildiği satır gönderilmeli');
  assert.equal(gelen[0].rowPatches[0].orderCode, 100);
  // §32: kapsam dışı abone HİÇBİR ŞEY almamalı — boş olay bile değil.
  assert.equal(yasakli.events().length, 0, 'kapsam dışı aboneye alan değeri gitmemeli');
  const gonderilen = JSON.stringify(izinli.events());
  assert.ok(!gonderilen.includes('12.5'), 'başka kapsamın Supp. FOB değeri sızmamalı');

  liveEvents.removeClient(a); liveEvents.removeClient(b);
});

test('v7.19 süzgeç kurulmadıysa hiçbir alan değeri yayınlanmaz', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const abone = fakeSubscriber('süzgeçsiz');
  const entry = liveEvents.addClient(abone.res, 'c1', { req: {} });
  liveEvents.setPatchAuthorizer(null);
  liveEvents.notifyChange('orders', 'yazan', { rowPatches: [{ orderCode: 1, patch: { suppFob: 9 } }] });
  t.mock.timers.tick(3000);
  assert.equal(abone.events().length, 0, 'yetki süzgeci yoksa güvenli taraf seçilmeli');
  liveEvents.removeClient(entry);
});

test('v7.19 yamalanamayan tek bir değişiklik bütün turu yeniden yüklemeye düşürür', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const abone = fakeSubscriber('a');
  const entry = liveEvents.addClient(abone.res, 'c1', { req: {} });
  liveEvents.setPatchAuthorizer((_e, patches) => patches);

  liveEvents.notifyChange('orders', 'yazan', { rowPatches: [{ orderCode: 1, patch: { notes: { Notes: 'x' } } }] });
  liveEvents.notifyChange('orders', 'yazan', { rowPatches: null }); // yapısal değişiklik
  t.mock.timers.tick(3000);

  const events = abone.events();
  assert.equal(events.length, 1, 'throttle turu tek olayda birleşmeli');
  assert.equal(events[0].mode, 'reload', 'yarım yama uygulamak yerine yeniden yükleme istenmeli');
  assert.equal(events[0].rowPatches, undefined, 'reload olayı alan değeri taşımamalı');
  liveEvents.removeClient(entry);
});

test('v7.19 kısa aralıklı yazmalar tek olayda birleşir', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const abone = fakeSubscriber('a');
  const entry = liveEvents.addClient(abone.res, 'c1', { req: {} });
  liveEvents.setPatchAuthorizer((_e, patches) => patches);
  for (let i = 0; i < 5; i += 1) {
    liveEvents.notifyChange('orders', 'yazan', { rowPatches: [{ orderCode: 10 + i, patch: { notes: { Notes: `n${i}` } } }] });
    t.mock.timers.tick(200);
  }
  t.mock.timers.tick(3000);
  const events = abone.events();
  assert.equal(events.length, 1, 'beş yazma tek olayda birleşmeli');
  assert.equal(events[0].rowPatches.length, 5, 'hiçbir satır kaybolmamalı');
  liveEvents.removeClient(entry);
});

/* ---------------- Sunucu: yetki ve bağlantı ---------------- */

test('v7.19 abonenin oturum profili yayın anında taze çözülür', () => {
  // Profil nesnesi kopyalanıp saklansaydı, oturum sürerken yetkisi daraltılan
  // bir kullanıcı eski kapsamıyla veri almaya devam ederdi.
  const block = blockOf(SERVER, "app.get('/api/live-events'", 'const ROW_PATCH_IDENTITY_KEYS');
  assert.match(block, /liveEvents\.addClient\(res, String\(req\.query\.clientId \|\| ''\), \{ req \}\)/);
  assert.match(block, /userAccess\.sessionProfile\(entry\.req\)/);
  assert.match(block, /if \(!profile\) return \[\];/);
});

test('v7.19 görünürlük kararı otoriter sipariş anlık görüntüsünden alınır', () => {
  const block = blockOf(SERVER, 'function liveEventCanSeeOrder', 'liveEvents.setPatchAuthorizer');
  // İstemciden gelen hiçbir değer otorite değildir.
  assert.match(block, /userAccess\.authoritativeOrderRows\(Number\(orderCode\)\)/);
  assert.match(block, /if \(!rows\.length\) return false;/, 'otorite bilmiyorsa gönderilmemeli');
  assert.match(block, /userAccess\.filterRowsByScope\(profile, rows\)\.length > 0/);
});

test('v7.19 satır yazma uçları incremental yama taşır; tam checkpoint hydration ayrı full-refresh olayıdır', () => {
  const calls = [...SERVER.matchAll(/liveEvents\.notifyChange\('orders'[^\n]*/g)].map(match => match[0]);
  assert.ok(calls.length >= 4, `orders bildirimi beklenenden az: ${calls.length}`);
  const checkpointCalls = calls.filter(call => /notifyChange\('orders',null\)/.test(call));
  assert.equal(checkpointCalls.length, 1, 'yalnız business-checkpoint hydration full-refresh bildirimi kullanmalı');
  const incremental = calls.filter(call => !/notifyChange\('orders',null\)/.test(call));
  incremental.forEach(call => assert.match(call, /rowPatches:/, `satır yazma bildirimi yama taşımalı: ${call}`));
  const hydrate = blockOf(SERVER, 'async function hydrateBusinessCheckpointIfNeeded', 'async function applyMasterCheckpoint');
  assert.match(hydrate, /notifyChange\('collection-workspaces',null\);liveEvents\.notifyChange\('orders',null\);liveEvents\.notifyChange\('overrides',null\)/);
});

test('v7.19 tek bir güvensiz öğe bütün turu yeniden yüklemeye düşürür', () => {
  const block = blockOf(SERVER, 'function liveRowPatchesFor', 'function projectionPatchMatches');
  assert.match(block, /rowPatchIncrementalSafe\(item\.patch\)/);
  assert.match(block, /clean\.length === list\.length \? clean : null/);
});

/* ---------------- İstemci: kilit yok, yenileme yok ---------------- */

test('v7.19 canlı olay hiçbir koşulda tam kaynak yenilemesi başlatmaz', () => {
  const block = blockOf(APP, 'function initLiveSync()', "window.addEventListener('bl-shared-revision'");
  assert.doesNotMatch(block, /loadFromServer\(true/, 'canlı olay force=true yenileme çağırmamalı');
  assert.match(block, /applyRemoteRowPatches\(payload\.rowPatches\)/);
  // Yapısal değişiklikte bile HAFİF yol kullanılmalı.
  assert.match(block, /loadFromServer\(false\)/);
});

test('v7.19 aynı düzenleme için ikinci bir yeniden yükleme yolu kalmadı', () => {
  const block = blockOf(APP, "window.addEventListener('bl-shared-revision'", '// ================= NOT DEFTERİ');
  assert.match(block, /if\(liveSyncConnected\)return;/, 'canlı akış açıkken bu yol yedek olmalı');
});

test('v7.19 uzak yama satırı yerinde günceller ve türevleri korur', () => {
  const source = blockOf(APP, 'function remoteRowLists()', 'function remoteEditingRowIds()');
  const formulaCalls = [];
  const scene = new Function('deps', `
    const { state, CP_IMAGE_API, BLImageRuntime, applyFormulas, invalidateUnifiedPriorityDecisions, scheduleOverviewRender } = deps;
    ${source}
    return { remotePatchMatches, applyRemoteRowPatch };
  `)({
    state: {},
    CP_IMAGE_API: '/api/cp-images',
    BLImageRuntime: { invalidate() {} },
    applyFormulas: row => { formulaCalls.push(row); },
    invalidateUnifiedPriorityDecisions() {},
    scheduleOverviewRender() {},
  });

  const row = { 'Order Code': 500, 'Model Name': 'M', 'C.Code': 'C', Notes: '', 'Ek Not': '' };
  assert.equal(scene.remotePatchMatches(row, { orderCode: 500, patch: {} }), true, 'model/renk gelmezse sipariş eşleşmesi yeterli');
  assert.equal(scene.remotePatchMatches(row, { orderCode: 500, patch: { model: 'BASKA' } }), false);
  assert.equal(scene.remotePatchMatches(row, { orderCode: 501, patch: {} }), false);

  scene.applyRemoteRowPatch(row, { notes: { Notes: 'yeni' } });
  assert.equal(row.Notes, 'yeni');
  assert.equal(row['Ek Not'], '', 'gönderilmeyen alt alan ezilmemeli');
  assert.equal(formulaCalls.length, 0, 'yalnız not değiştiyse formül yeniden hesaplanmaz');

  scene.applyRemoteRowPatch(row, { dates: { retailDate: '2026-10-05' } });
  assert.equal(row['Retail Date'], '2026-10-05');
  assert.equal(formulaCalls.length, 1, 'tarih değişince türev alanlar yeniden hesaplanmalı');

  scene.applyRemoteRowPatch(row, { suppFob: 14.25 });
  assert.equal(row['Supp. FOB'], 14.25);
  assert.equal(row._suppFobManual, true);
  scene.applyRemoteRowPatch(row, { imageRef: 'img1' });
  assert.equal(row._imageUrl, '/api/cp-images/img1');
  scene.applyRemoteRowPatch(row, { imageRef: '' });
  assert.equal(row._imageUrl, '', 'görsel kaldırma da taşınmalı');
});

test('v7.19 istemci yaması sunucudaki artımlı yamayla aynı alanları yazar', () => {
  // İki uygulama ayrışırsa karşı ekran sessizce yanlış değer gösterir.
  const client = blockOf(APP, 'function applyRemoteRowPatch(row,patch)', 'function remoteEditingRowIds()');
  const server = blockOf(SERVER, 'function applyIncrementalProjectionPatch(row, patch, overrides, includePriority = true)', 'function rewriteProjectionCacheForRowPatches');
  const fields = ["row.Notes", "row['Ek Not']", "row['Supp. FOB']", "row['Del. Type']", 'row._suppFobManual', 'row._suppFobOverride', 'row._suppFobRule', 'row._suppFobMeta', 'row._imageRef', 'row._imageUrl'];
  fields.forEach(field => {
    assert.ok(client.includes(field), `istemci yaması ${field} alanını yazmalı`);
    assert.ok(server.includes(field), `sunucu yaması ${field} alanını yazmalı`);
  });
  ['exFactory', 'retailDate', 'inStoreDate'].forEach(key => {
    assert.ok(client.includes(key) && server.includes(key), `${key} iki tarafta da taşınmalı`);
  });
});

test('v7.19 düzenlenen satır uzaktan ezilmez, düzenleme bitince uygulanır', () => {
  const block = blockOf(APP, 'function applyRemoteRowPatches(rowPatches)', 'let liveSyncConnected=false;');
  assert.match(block, /busyRows&&busyRows\.has\(String\(row\._id\)\)/, 'düzenlenen satır atlanmalı');
  assert.match(block, /deferred\.push\(item\)/, 'atlanan yama kaybolmamalı');
  assert.match(block, /remoteDeferredPatches=deferred/);
  // focusout ile ertelenen yamalar uygulanmalı.
  assert.match(block, /addEventListener\('focusout'/);
  assert.match(block, /applyRemoteRowPatches\(pending\)/);
});

test('v7.19 uzak yama kullanıcının kendi çalışma durumunu silmez', () => {
  // loadFromServer bu alanları sıfırlıyor; uzak yama yolu ona hiç uğramamalı.
  const block = blockOf(APP, 'function applyRemoteRowPatches(rowPatches)', 'let liveSyncConnected=false;');
  ['state.cpDirty', 'state.cpSelected', 'state.ordersSelected', 'undoStack'].forEach(name => {
    assert.ok(!block.includes(name), `${name} uzak yama yolunda sıfırlanmamalı`);
  });
  assert.ok(!block.includes('setReadOnlyMode'), 'uzak yama ekranı salt-okunur moda düşürmemeli');
});

test('v7.19 değişen satır görünür kılınır ama yerleşimi bozmaz', () => {
  assert.match(APP, /tr\.classList\.add\('blRemoteChanged'\)/);
  const style = require('./helpers/manifest-css').rules(/tr\.blRemoteChanged/);
  assert.match(style,/background-color:color-mix/);
  assert.match(style,/animation:none/);
  for(const prop of ['height','border','padding','font-size']) assert.doesNotMatch(style,new RegExp(prop+'\\s*:'));
  require('./helpers/manifest-css').assertStaticMotion();
});

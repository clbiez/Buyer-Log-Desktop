'use strict';

// v6.03 — Yenileme belirli aralıklarla kendiliğinden çalışabiliyor.
//
// Yenileme zaten sunucuda arka planda koşuyordu (istek hemen dönüyor, iş
// sürüyor); eksik olan onu başlatan zamanlayıcıydı. Zamanlayıcı SUNUCUDA değil
// açık uygulamada durur: sunucu son pencere kapandığında kendini kapatıyor
// (AUTO_EXIT) ve yenileme kullanıcının kendi veri belleğine yazıyor — sahipsiz
// bir zamanlayıcı kimin adına yenileyeceğini bilemezdi.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const APP = fs.readFileSync(path.join(ROOT, 'public', 'app-main.js'), 'utf8');
const HTML = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');
const CSS = fs.readFileSync(path.join(ROOT, 'public', 'app.css'), 'utf8');

function blockOf(from, to) {
  const start = APP.indexOf(from);
  assert.ok(start >= 0, `${from} bulunmalı`);
  const end = APP.indexOf(to, start);
  assert.ok(end > start, `${to} bulunmalı`);
  return APP.slice(start, end);
}

test('v6.03 aralık seçenekleri ve varsayılan KAPALI', () => {
  const choices = new Function(`${APP.slice(APP.indexOf('const AUTO_REFRESH_CHOICES='), APP.indexOf('let autoRefreshTimer='))} return AUTO_REFRESH_CHOICES;`)();
  assert.deepEqual(choices, [0, 15, 30, 60, 120, 240]);
  // Varsayılan kapalı olmalı: kullanıcı istemeden arka planda sorgu başlamaz.
  const read = value => new Function('BLStorage', 'AUTO_REFRESH_KEY', 'AUTO_REFRESH_CHOICES',
    `${blockOf('function autoRefreshMinutes()', 'function setAutoRefreshMinutes')} return autoRefreshMinutes();`
  )({ getItem: () => value }, 'k', [0, 15, 30, 60, 120, 240]);
  assert.equal(read(null), 0);
  assert.equal(read('30'), 30);
  // Listede olmayan bir değer kabul edilmemeli (bozuk/elle düzenlenmiş kayıt).
  assert.equal(read('7'), 0);
  assert.equal(read('abc'), 0);
});

test('v6.03 seçenekler arayüzde de aynı', () => {
  /* v7.81: otomatik yenileme "Kaynak Veri" şeridinden Veri Yönetimi ekranındaki
     Yenileme bölümüne taşındı — yenileme gruplarıyla aynı soruyu cevaplıyor
     ("veri ne zaman tazelenir?") ve iki ayrı yerde durması iki ayrı yenileme
     kavramı izlenimi veriyordu. Korunan iddia aynı: sunucu tarafındaki dakika
     listesiyle arayüzdeki seçenekler ÖRTÜŞMELİ. */
  const dmUi = fs.readFileSync(path.join(ROOT, 'public', 'data-management.js'), 'utf8');
  const start = dmUi.indexOf('id="autoRefreshSelect"');
  assert.notEqual(start, -1, 'seçici Veri Yönetimi ekranında olmalı');
  const block = dmUi.slice(start, dmUi.indexOf('</select>', start));
  [15, 30, 60, 120, 240].forEach(minutes => assert.match(block, new RegExp(`value="${minutes}"`)));
  assert.match(block, /value="0"/);
  // "Kapalı" seçeneği iki dilde.
  assert.match(block, /T\('Kapalı', 'Off'\)/);
});

test('v6.03 uygun olmayan anlarda tur atlanıyor', () => {
  const block = blockOf('function autoRefreshBlockedReason()', 'function scheduleAutoRefresh()');
  // Üst üste binen yenileme olmamalı.
  assert.match(block, /if\(isRefreshRunning\(\)\)/);
  // Hücre düzenlenirken yenileme tabloyu yeniden çizer ve yazılan değer kaybolurdu.
  assert.match(block, /input,textarea,select,\[contenteditable="true"\]/);
  // Açık pencere varken kullanıcının işi bölünmemeli.
  assert.match(block, /blOverlayOpen\(\)/);
  // Uygunsa boş dize dönmeli.
  assert.match(block, /return '';/);
});

test('v6.03 atlanan tur kaybolmuyor, tam aralıkla erteleniyor', () => {
  const block = blockOf('function runAutoRefresh()', 'function autoRefreshLabel()');
  assert.match(block, /const blocked=autoRefreshBlockedReason\(\);/);
  // Erteleme scheduleAutoRefresh ile yapılmalı; kısa aralıkla yeniden denemek
  // açık bir pencere varken saniyede bir sorgu anlamına gelirdi.
  assert.match(block, /if\(blocked\)\{[\s\S]*?scheduleAutoRefresh\(\);[\s\S]*?return;/);
  // Uygunsa gerçek yenileme çağrılmalı, düğmenin çağırdığı yolun aynısı.
  assert.match(block, /loadFromServer\(true,\['cp','orders','backlog','lfl'\]\)/);
  // Hata zamanlayıcıyı durdurmamalı.
  assert.match(block, /catch\(err\)\{ console\.warn\('Otomatik yenileme başlatılamadı:',err\); \}/);
});

test('v6.03 zamanlayıcı üst üste binmiyor', () => {
  const block = blockOf('function scheduleAutoRefresh()', 'function runAutoRefresh()');
  // Yeniden planlarken önceki zamanlayıcı iptal edilmeli.
  assert.match(block, /if\(autoRefreshTimer\)\{ clearTimeout\(autoRefreshTimer\); autoRefreshTimer=null; \}/);
  // Kapalıyken hiç kurulmamalı.
  assert.match(block, /if\(!minutes\)return;/);
});

test('v6.03 elle yenilemeden sonra sayaç baştan başlıyor', () => {
  // Elle yenileyen kullanıcı hemen ardından otomatik bir tur daha görmemeli.
  assert.match(APP, /window\.addEventListener\('bl-refresh-finished',\(\)=>scheduleAutoRefresh\(\)\)/);
  assert.match(APP, /dispatchEvent\(new Event\('bl-refresh-finished'\)\)/);
});

test('otomatik veya manuel veri yenilemesi acik tablo gorunumunu favoriye resetlemez', () => {
  const load = blockOf('async function loadFromServer(', 'let sharedRevisionSnapshot=');
  // Favori profil yalnız gerçek ilk ekran yüklemesinde uygulanır. Daha sonraki
  // yenilemeler profil listesini okuyabilir, fakat kullanıcının canlı
  // Focus/Extended/All ve filtre seçimini yeniden uygulayamaz.
  assert.match(load, /applyCachedProfilesForCurrentPage\(initialScreenLoad\)/);
  assert.doesNotMatch(load, /applyCachedProfilesForCurrentPage\(true\)/);
});

test('v6.03 sıradaki tur saati kullanıcıya gösteriliyor', () => {
  const start = APP.indexOf('function autoRefreshLabel()');
  const block = APP.slice(start, APP.indexOf('function renderAutoRefreshState()', start));
  assert.match(block, /Otomatik yenileme: kapalı/);
  assert.match(block, /sıradaki/);
  // Not alanı ve Yenile düğmesinin ipucu güncellenmeli.
  // Bitiş çıpası dikkatli seçilmeli: fonksiyonun İÇİNDE de autoRefreshSelect geçiyor.
  const render = blockOf('function renderAutoRefreshState()', "window.addEventListener('bl-refresh-finished'");
  assert.match(render, /getElementById\('autoRefreshNote'\)/);
  assert.match(render, /getElementById\('serverRefreshBtn'\)/);
});

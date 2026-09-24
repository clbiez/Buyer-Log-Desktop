'use strict';
/* v9.15 — PLM Operasyon Merkezi (istemci).

   Sayfalar arası karışmanın ÜÇÜNCÜ sebebi istemcideydi: ilerleme izleyicisi
   modül düzeyinde TEK bir zamanlayıcı değişkeni kullanıyordu. İkinci bir
   işlem başlayınca birincinin tutamacını eziyor, birincinin aralığı hiç
   durdurulamıyor ve iki işlem aynı düğmeye yazmaya devam ediyordu.

   Bu dosya hem o düzeltmeyi hem de operasyon merkezinin sözleşmesini sınar.
   app-main.js/plm-operations.js DOM'a bağlı olduğu için projedeki yerleşik
   kural uygulanır: KAYNAK METİN eşleştirmesi. Saf yardımcılar (süre biçimi)
   ise gerçekten çalıştırılarak sınanır. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const APP = read('public/app-main.js');
const OPS = read('public/plm-operations.js');
const CSS = read('public/app.css');
const INDEX = read('public/index.html');

/* ---- 3. sebep: tek zamanlayıcı ---- */

test('REGRESYON: ilerleme izleyicisinin zamanlayıcısı artık kapanışta tutulur', () => {
  const start = APP.indexOf('function watchModelOperationProgress');
  const end = APP.indexOf('async function fetchPlmImageForModel', start);
  assert.ok(start >= 0 && end > start);
  const block = APP.slice(start, end);
  // Her çağrının kendi tutamacı olmalı.
  assert.match(block, /let timer=null,stopped=false;/);
  assert.match(block, /return \(\)=>\{stopped=true;if\(timer\)\{clearInterval\(timer\);timer=null;\}/);
  // Modül düzeyindeki paylaşılan değişken kalmamalı.
  assert.doesNotMatch(APP, /let modelOperationProgressTimer=null;/);
  assert.doesNotMatch(block, /modelOperationProgressTimer/);
});

test('izleme durdurulduktan sonra düğmeye yazmaz', () => {
  const start = APP.indexOf('function watchModelOperationProgress');
  const block = APP.slice(start, APP.indexOf('async function fetchPlmImageForModel', start));
  // Uçuşta kalan istek geri dönerse eski metni geri yazmamalı.
  assert.match(block, /if\(!stopped&&q&&q\.total\)/);
});

/* ---- kapsam izolasyonu ---- */

test('sayfa şeridi YALNIZ kendi kapsamının işlerini gösterir', () => {
  const start = OPS.indexOf('function renderStrip');
  const block = OPS.slice(start, OPS.indexOf('function renderPanel', start));
  assert.match(block, /const scope = activeScope\(\)/);
  assert.match(block, /jobsForScope\(scope\)\.filter\(job => job\.running\)/);
  // Kapsam yoksa şerit hiç gösterilmez; başka sayfanın işi sızmaz.
  assert.match(block, /if \(!scope \|\| !running\.length\)/);
});

test('operasyon merkezi kapsam süzmez — hepsini gösterir', () => {
  const start = OPS.indexOf('function renderPanel');
  const block = OPS.slice(start, OPS.indexOf('async function loadFailures', start));
  assert.match(block, /const all = state\.jobs;/);
  assert.match(block, /Çalışan işler/);
  assert.match(block, /Geçmiş/);
});

test('istemci kapsamı sunucuya gönderiyor', () => {
  // Link ve görsel her üç ekrandan çalıştığı için kapsam istekte gitmeli.
  assert.match(APP, /sync-links[^\n]*scope:source/);
  assert.match(APP, /import-plm[^\n]*\n?[^\n]*scope:source|scope:source[^\n]*mode:requestMode|mode:requestMode,scope:source/);
});

/* ---- ölçüler ---- */

test('süre biçimi okunur ve sınırlarda doğru', () => {
  // Modülü çalıştırmadan saf fonksiyonu ayıklayıp koştur.
  const start = OPS.indexOf('function humanDuration');
  const end = OPS.indexOf('async function api', start);
  const source = OPS.slice(start, end);
  const humanDuration = new Function('t', `${source}\nreturn humanDuration;`)((tr) => tr);
  assert.equal(humanDuration(0), '0sn');
  assert.equal(humanDuration(45_000), '45sn');
  assert.equal(humanDuration(60_000), '1dk');
  assert.equal(humanDuration(200_000), '3dk 20sn');
  assert.equal(humanDuration(3_900_000), '1sa 05dk');
});

test('anlamsız ölçü gösterilmez (hız 0 / ETA yok)', () => {
  const start = OPS.indexOf('function jobMetrics');
  const block = OPS.slice(start, OPS.indexOf('function failureTable', start));
  assert.match(block, /if \(job\.ratePerMinute > 0\)/);
  assert.match(block, /if \(job\.etaMs != null && job\.running\)/);
});

test('istenen ölçülerin hepsi var', () => {
  const start = OPS.indexOf('function jobMetrics');
  const block = OPS.slice(start, OPS.indexOf('function failureTable', start));
  for (const caption of ['Toplam', 'İşlenen', 'Başarılı', 'Başarısız', 'Kalan', 'Geçen süre', 'Hız', 'Tahmini kalan']) {
    assert.ok(block.includes(caption), `${caption} ölçüsü olmalı`);
  }
  // Aktif model iş kartında gösterilir.
  assert.match(OPS, /İşlenen model: /);
});

/* ---- hata detayı ve yeniden deneme ---- */

test('hatalı modeller detaylandırılabiliyor', () => {
  const start = OPS.indexOf('function failureTable');
  const block = OPS.slice(start, OPS.indexOf('function jobCard', start));
  assert.match(block, /PLM ID/);
  assert.match(block, /item\.code/);
  assert.match(block, /item\.error/);
  assert.match(OPS, /\/api\/plm-jobs\/\$\{encodeURIComponent\(jobId\)\}/);
});

test('REGRESYON: açık hata detayı 1sn polling renderında kapanmaz veya Loading durumuna dönmez', () => {
  assert.match(OPS, /failureCache: new Map\(\)/);
  assert.match(OPS, /failureLoads: new Map\(\)/);
  assert.match(OPS, /const jobId = String\(job && job\.id != null \? job\.id : ''\)/);
  assert.match(OPS, /const cached = state\.failureCache\.get\(jobId\)/);
  assert.match(OPS, /cached \? failureTable\(cached\.failures\)/);
  assert.match(OPS, /const scrollTop = body\.scrollTop/);
  assert.match(OPS, /body\.scrollTop = scrollTop/);
  assert.match(OPS, /cached\.failureCount !== Number\(job\.failureCount \|\| 0\)/);
  assert.match(OPS, /const pending = state\.failureLoads\.get\(id\)/);
  assert.match(OPS, /state\.failureCache\.set\(id, \{ failureCount: Number\(current\.failureCount \|\| 0\), failures \}\)/);
});

test('yalnız başarısızlar yeniden denenebiliyor ve akış devredilir', () => {
  assert.match(OPS, /failed-ids/);
  // Merkez kendi "yalnız başarısızlar" yolunu yazmaz; başlatan akışa devreder.
  assert.match(OPS, /window\.BLPlmOpsRetry && window\.BLPlmOpsRetry\[data\.kind\]/);
  // app-main tarafında dört iş türü için de kanca var.
  for (const kind of ['plm-links', 'plm-images', 'plm-files', 'plm-sync']) {
    assert.ok(APP.includes(`'${kind}':async(`), `${kind} için yeniden deneme kancası olmalı`);
  }
});

test('yeniden deneme, model artık tabloda yoksa sessizce başarısız olmaz', () => {
  const start = APP.indexOf('window.BLPlmOpsRetry={');
  const block = APP.slice(start, start + 3000);
  assert.ok((block.match(/artık tabloda değil|artık Koleksiyon/g) || []).length >= 3);
});

/* ---- arka plan ve yoklama ---- */

test('yoklama yalnız gerektiğinde çalışır', () => {
  const start = OPS.indexOf('function syncPolling');
  const block = OPS.slice(start, OPS.indexOf('function jobsForScope', start));
  assert.match(block, /state\.panelOpen \|\| state\.jobs\.some\(job => job\.running\)/);
  assert.match(block, /clearInterval\(state\.timer\)/);
});

test('sekme değişince şerit yeniden çizilir (kapsam değişti demektir)', () => {
  assert.match(OPS, /MutationObserver/);
  assert.match(OPS, /attributeFilter: \['data-active-tab'\]/);
});

test('sayfa açılışında arka planda süren iş hemen görünür', () => {
  assert.match(OPS, /if \(document\.readyState === 'loading'\)/);
  assert.match(OPS, /void refresh\(\)/);
});

test('PLM işlemi başlarken operasyon merkezi otomatik açılır', () => {
  assert.match(APP, /function notifyPlmOperationStarted\(url,options\)/);
  for (const endpoint of ['/api/plm-sync/fetch', '/api/plm-style-links/sync-links', '/api/model-images/import-plm', '/api/plm-sync/model-files']) {
    assert.ok(APP.includes(`'${endpoint}'`), `${endpoint} otomatik açılış eşlemesine girmeli`);
  }
  assert.match(APP, /window\.BLPlmOps\?\.open\?\./);
  assert.match(APP, /bl:plm-operation-started/);
  assert.match(OPS, /addEventListener\('bl:plm-operation-started'/);
  assert.match(OPS, /function autoOpenOnOperationStart\(event\)/);
});

/* ---- tema bütünlüğü ---- */

test('arayüz mevcut Buyer Log bileşenlerini kullanıyor', () => {
  // Kabuklar ve bileşenler yeniden kullanılmalı, sıfırdan uydurulmamalı.
  assert.match(OPS, /className = 'warnOverlay'/);
  assert.match(OPS, /modalCard verHistCard/);
  assert.match(OPS, /kolPlanStat plmOpsStat/);
  assert.match(OPS, /badge plmOpsBadge/);
  assert.match(OPS, /class="tbtn"/);
  assert.match(OPS, /plmImportTableWrap/);
});

test('stiller yalnız tema değişkenlerini kullanıyor ve köşe yuvarlamıyor', () => {
  const start = CSS.indexOf('PLM OPERASYON MERKEZİ');
  /* v9.53: blok SINIRLANDI. Eskiden dosya sonuna kadar uzanıyordu; sonradan
     eklenen bambaşka bölümlerin stilleri PLM stili sanılıp test kırılıyordu.
     Test adı PLM Operasyon Merkezi'ni ölçtüğünü söylüyor; blok da onu ölçmeli. */
  const nextSection = CSS.indexOf('E-MAIL GROUPS V2', start);
  const block = CSS.slice(start, nextSection > start ? nextSection : CSS.length);
  assert.ok(block.length > 500, 'stil bloğu bulunmalı');
  // Sabit renk kodu olmamalı (tema dışına çıkmamalı).
  assert.doesNotMatch(block, /#[0-9a-fA-F]{3,6}\b/);
  // Uygulama köşe yuvarlaması kullanmıyor.
  assert.doesNotMatch(block, /border-radius:\s*(?!var\(--r-full\))[0-9]/);
  // Durum renkleri tema değişkenlerinden.
  assert.match(block, /var\(--green\)/);
  assert.match(block, /var\(--red\)/);
  assert.match(block, /var\(--acc\)/);
});

test('modül yükleniyor ve menülerden erişilebiliyor', () => {
  assert.match(read('public/perf-runtime.js'), /plm-operations\.js/);
  // Üç ekranın PLM Sync menüsünde de giriş noktası olmalı.
  assert.equal((INDEX.match(/data-plmops-open/g) || []).length, 3);
});

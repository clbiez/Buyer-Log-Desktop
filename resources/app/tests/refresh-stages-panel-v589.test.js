'use strict';

// v5.89 — Yenileme sırasındaki sayaca tıklayınca aşama dökümü.
//
// Sayaç yalnız toplam süreyi gösteriyordu; sürenin nerede geçtiği ancak iş
// bittikten sonra, kaybolup giden tek satırlık bir bildirimde görünüyordu.
// Artık sayaç tıklanabilir ve iki bilgiyi birleştiren bir panel açar:
//   · Aşamalar (sunucu sorgusu / karşılaştırma / kaydetme) ve süreleri,
//   · Bağlantı bazında sunucu sorgusu / veri yazımı / ayrıştırma dökümü.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const APP = fs.readFileSync(path.join(ROOT, 'public', 'app-main.js'), 'utf8');
const CSS = fs.readFileSync(path.join(ROOT, 'public', 'app.css'), 'utf8');
const SERVER = fs.readFileSync(path.join(ROOT, 'server', 'server.js'), 'utf8');
const REFRESH = fs.readFileSync(path.join(ROOT, 'server', 'lib', 'model-refresh.js'), 'utf8');

test('v5.89 sunucu aşama geçişlerini zaman damgasıyla kaydediyor', () => {
  const block = SERVER.slice(SERVER.indexOf('async function performRefresh'), SERVER.indexOf("app.get('/api/refresh-status'"));
  assert.match(block, /const markPhase\s*=\s*phase\s*=>\s*markRefreshJobPhase\(id,phase\)/);
  // Kaynak yükleme alt aşamalarını kendi callback'i işaretler; üst akış diğer
  // aşamaları aynı wall-clock zaman çizelgesinde sürdürür.
  assert.match(block, /markPhase, telemetry/);
  assert.match(block, /markPhase\('page-cache'\)/);
  assert.match(block, /markPhase\('comparing'\)/);
  assert.match(block, /markPhase\('saving'\)/);
  // Bir aşama başlarken bir önceki kapatılmalı, yoksa süreler hesaplanamaz.
  assert.match(SERVER, /previous\.ms=now-previous\.startedMs/);
});

test('v5.89 iş durumu aşamaları istemciye taşıyor', () => {
  const block = SERVER.slice(SERVER.indexOf('function refreshJobState'), SERVER.indexOf('async function performRefresh'));
  assert.match(block, /phases: Array\.isArray\(job\.phases\)/);
  // Süren aşamanın süresi anlık hesaplanmalı, aksi halde panelde 0 görünürdü.
  assert.match(block, /ms: item\.ms != null \? item\.ms : \(job\.running \? Date\.now\(\) - item\.startedMs : 0\)/);
  assert.match(block, /running: item\.endedMs == null/);
});

test('v5.89 son aşama iş bitince kapatılıyor', () => {
  // Kapatılmazsa "Kaydetme" aşaması sonsuza dek sürüyor görünürdü.
  assert.match(SERVER, /if \(last && !last\.endedMs\) \{ last\.endedMs = Date\.now\(\); last\.ms = last\.endedMs - last\.startedMs; \}/);
});

test('v5.89 bağlantı bazlı süre bileşenleri panele taşınıyor', () => {
  // Kaynak: model-refresh bağlantı, sorgu, yazım ve parse sürelerini ayırıyor.
  assert.match(REFRESH, /connectionOpenMs: Number\(result\.connectionOpenMs\)/);
  assert.match(REFRESH, /executeMs: Number\(result\.executeMs\)/);
  assert.match(REFRESH, /writeMs: Number\(result\.writeMs\)/);
  assert.match(REFRESH, /const parseMs = Number\(result\.parseMs\)/);
  // Panel bu üçünü ayrı sütun olarak gösteriyor.
  const body = APP.slice(APP.indexOf('function renderRefreshStagesBody'), APP.indexOf('function openRefreshStagesModal'));
  assert.match(body, /refreshSeconds\(t\.executeMs\)/);
  assert.match(body, /refreshSeconds\(t\.connectionOpenMs\)/);
  assert.match(body, /refreshSeconds\(t\.writeMs\)/);
  assert.match(body, /refreshSeconds\(t\.parseMs\)/);
  assert.match(body, /refreshSeconds\(t\.totalMs\)/);
});

// v7.90'da eklenen otomatik açılma Packet 13 ile bilerek kaldırıldı: pencere
// artık yalnız kullanıcı bir yenileme/ilerleme kontrolüne AÇIKÇA tıkladığında
// açılır (eski bildirim yerine geçme fikri duruyor — showSourceRefreshAdvisory
// hâlâ paneli açıyor — yalnız "yenileme başlarken kendiliğinden" kısmı gitti).
test('v10.13 yenileme başlarken Refresh Stages artık kendiliğinden AÇILMIYOR', () => {
  assert.match(APP, /function showSourceRefreshAdvisory\(\)\{ openRefreshStagesModal\(\); \}/);
  assert.match(APP, /if\(userVisibleRefresh\)\{ setRefreshFailureState\(false\); \}/);
  assert.doesNotMatch(APP, /if\(userVisibleRefresh\)\{ setRefreshFailureState\(false\); openRefreshStagesModal\(\); \}/);
  assert.doesNotMatch(APP, /sourceRefreshAdvisoryTimer|stagesBound/);
});

test('refresh başlangıcı ilerlemeyi düğme spinner\'ıyla gösterir; panel yalnız çalışırken tıklanınca açılır ve odaklanır', () => {
  assert.match(APP, /if\(window\.BL_REFRESH_BUSY\)\{ openRefreshStagesModal\(\); return; \}/);
  assert.match(APP, /const existing=document\.getElementById\('_refreshStages'\);/);
  assert.match(APP, /existing\.querySelector\('\.refreshStagesCard'\)\?\.focus\(\{preventScroll:true\}\)/);
  assert.match(APP, /modal\.className='refreshStagesOverlay'/);
  assert.doesNotMatch(APP, /Data model refresh is running|Veri modeli yenileniyor/);
});

test('Refresh Stages paneli sağ üstte non-blocking ve iç scroll olmadan açılır', () => {
  assert.match(CSS, /\.refreshStagesOverlay\{[^}]*pointer-events:none/);
  assert.match(CSS, /\.refreshStagesOverlay\{[^}]*align-items:flex-start/);
  assert.match(CSS, /\.refreshStagesBody\{[^}]*overflow:visible/);
  assert.match(CSS, /\.refreshStagesCard\{[^}]*max-height:none/);
});

test('v5.89 panel iş sürerken canlı güncelleniyor', () => {
  const block = APP.slice(APP.indexOf('function openRefreshStagesModal'), APP.indexOf('window.openRefreshStagesModal='));
  assert.match(block, /modal\._timer=setInterval/);
  // Pencere kapanınca zamanlayıcı durmalı, yoksa arkada çalışmaya devam ederdi.
  assert.match(block, /clearInterval\(modal\._timer\)/);
  assert.match(block, /if\(!modal\.isConnected\)\{ clearInterval\(modal\._timer\); return; \}/);
  // Yoklama her turda paneli tazelemeli.
  assert.match(APP, /window\.BL_REFRESH_JOB_STATE=jobState;/);
  assert.match(APP, /refreshStagesModalOpen\(\)\)renderRefreshStagesBody\(\)/);
});

test('v5.89 bağlantı dökümü henüz yokken sebebi yazılıyor', () => {
  const body = APP.slice(APP.indexOf('function renderRefreshStagesBody'), APP.indexOf('function openRefreshStagesModal'));
  // Boş tablo göstermek "veri kayıp" izlenimi verirdi; sorgular bitmeden bu
  // döküm oluşmuyor ve panel bunu açıkça söylüyor.
  assert.match(body, /Bağlantı bazlı döküm sorgular bittiğinde görünür/);
  assert.match(body, /Son yenileme için bağlantı süresi kaydı yok/);
  assert.match(body, /Henüz aşama bilgisi yok/);
});

test('v5.89 aşama adları iki dilde', () => {
  const map = new Function(`${APP.slice(APP.indexOf('const REFRESH_PHASE_LABELS'), APP.indexOf('function refreshPhaseLabel'))}; return REFRESH_PHASE_LABELS;`)();
  assert.deepEqual(Object.keys(map).sort(), ['antrepo-excel-parse','antrepo-excel-refresh','asas-excel-parse','asas-excel-refresh','comparing','database','dispatch-overhead','done','finalizing','page-cache','saving','source-processing','source-setup']);
  Object.values(map).forEach(item => {
    assert.ok(item.tr && item.en, 'her aşamanın iki dilde adı olmalı');
  });
  assert.equal(map.database.tr, 'Veritabanı işlemleri');
});

/* v7.33 — GÜNCELLENDİ, KALDIRILMADI (§156). Testin amacı değişmedi: aşama
   süresi ham/yuvarlanmamış gösterilsin ve bozuk değer uydurma sonuç
   üretmeyip sıfıra sabitlensin. Değişen yalnız BİRİM: kullanıcı "tüm
   sayaçların formatını 30,5 gibi saniye şeklinde göster" dediği için
   refreshSeconds artık ortak fmtDurationSn'ye devrediyor, milisaniye
   yazmıyor. Sıfıra sabitleme iddiası aynen korunuyor. */
test('v7.14/v7.33 yenileme aşama süreleri ortak saniye biçiminde gösterilir', () => {
  const fmt = new Function('appLang', `${APP.slice(APP.indexOf('function fmtDurationSn(ms){'), APP.indexOf('window.fmtDurationSn=fmtDurationSn;'))}; return fmtDurationSn;`)('tr');
  assert.match(APP, /function refreshSeconds\(ms\)\{\s*return fmtDurationSn\(ms\);/,
    'aşama süresi uygulamanın geri kalanıyla aynı biçimlendiriciden geçmeli');
  assert.equal(fmt(4200), '4,2 sn');
  assert.equal(fmt(0), '0,0 sn');
  // Negatif ya da bozuk değer sıfıra sabitlenmeli.
  assert.equal(fmt(-50), '0,0 sn');
  assert.equal(fmt('abc'), '0,0 sn');
});

'use strict';
/* v9.10 — PLM Sync birleştirmesi ve TP/TF modüllerinin kaldırılması.

   Kullanıcı talepleri:
     1. "PROMISE HATA: t is not defined" — bu projede global t() YOK.
     2. PLM'den TP/TF model dosyası çeken TÜM modüller silinecek.
     3. "Get Model Links from PLM" işlevi PLM Sync komutlarına bağlanacak.
     4. Yazılmadan önce hangi sütunların yazılacağı kullanıcıya seçtirilecek.
     5. LINE için çeviri önerisi yapılmayacak, PLM doğru kabul edilecek.
     6. CP ve Orders'a PLM Sync düğmesi — yalnız link + görsel.

   app-main.js DOM/global bağımlılığı yüzünden canlı çalıştırılamadığından,
   bu dosyadaki istemci sınamaları projedeki yerleşik kurala uyar: KAYNAK
   METİN eşleştirmesi (bkz. plm-sync-collection-engine-v908.test.js). */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const APP = read('public/app-main.js');
const INDEX = read('public/index.html');
const SERVER = require('./helpers/server-source')();
const CSS = read('public/app.css');

/* ---------- 1) "t is not defined" kök nedeni ---------- */

test('çeviri kaynağı ipucu global t() yerine appLang kullanır', () => {
  const start = APP.indexOf('function kolPlmSyncTranslationHint');
  const end = APP.indexOf('function kolPlmSyncFieldChangeRows', start);
  assert.ok(start >= 0 && end > start, 'kolPlmSyncTranslationHint bulunamadı');
  const block = APP.slice(start, end);
  // Hatanın kendisi: t('...','...') çağrısı. Bir daha girmesin.
  assert.doesNotMatch(block, /[^A-Za-z0-9_$.]t\(\s*['"`]/);
  assert.match(block, /const en=appLang==='en';/);
  assert.match(block, /'approved-rule':en\?/);
});

test('app-main.js çıplak t() çağrılarını yalnız yerel çeviri helper kapsamlarında kullanır', () => {
  const hits=[];
  APP.split('\n').forEach((line,index)=>{
    if(line.trim().startsWith('//')||!/[^A-Za-z0-9_$.]t\(/.test(line))return;
    const prefix=APP.split('\n').slice(Math.max(0,index-20),index+1).join('\n');
    if(!/const t=/.test(prefix))hits.push({line:index+1,text:line.trim()});
  });
  assert.deepEqual(hits, [], `yerel helper dışında çıplak t() bulundu: ${JSON.stringify(hits)}`);
});

/* ---------- 2) TP/TF modülleri tamamen kaldırıldı ---------- */

/* NOT: teknik föy indirme v9.11'de SIFIRDAN yeniden yazıldı (bkz.
   plm-technical-sheet-v911.test.js). Burada sınanan şey, ESKİ modülün geri
   sızmadığıdır: ayrı istemci/sunucu dosyaları, /api/plm-tp iş kuyruğu
   rotaları ve 15 TP/TF düğmesi. Yeni akış bunların hiçbirini kullanmaz. */
test('eski TP/TF modülü hiçbir katmanda geri gelmedi', () => {
  for (const file of [
    'public/plm-technical-sheets.js',
    'server/lib/plm-technical-sheets.js',
  ]) {
    assert.equal(fs.existsSync(path.join(root, file)), false, `${file} silinmeliydi`);
  }
  assert.doesNotMatch(SERVER, /\/api\/plm-tp/);
  assert.doesNotMatch(SERVER, /technicalSheetStore|technicalSheetJobs|createTechnicalSheetService/);
  assert.doesNotMatch(INDEX, /data-plm-tp-action/);
  assert.doesNotMatch(INDEX, /PlmTpBtn|DownloadTpBtn|DownloadTfBtn|OpenTpBtn|UpdateTpBtn/);
  assert.doesNotMatch(read('public/perf-runtime.js'), /plm-technical-sheets/);
  // Eski connector fonksiyonu (model başına tam Style List taraması yapan) geri gelmemeli.
  assert.doesNotMatch(read('server/lib/agent-browser-connector.js'), /function downloadCoreNectumTechnicalSheet\b/);
});

test('normalizePlmId TP modülüyle birlikte kaybolmadı, tarafsız bir modüle taşındı', () => {
  const plmId = require(path.join(root, 'server/lib/plm-id.js'));
  // TP modülündeki davranışın birebir aynısı.
  assert.equal(plmId.normalizePlmId('_002100968'), '2100968');
  assert.equal(plmId.normalizePlmId('2100968.0'), '2100968');
  assert.equal(plmId.normalizePlmId('abc'), '');
  assert.equal(plmId.normalizePlmId('0'), '');
  assert.match(SERVER, /require\('\.\/lib\/plm-id'\)/);
});

test('kullanıcının kendi yüklediği model dosyaları yöneticisi SİLİNMEDİ', () => {
  // TP deposu ayrı bir şeydi; /api/model-files kullanıcının kendi
  // eklerini tutar ve talebin kapsamı dışındadır.
  assert.match(SERVER, /app\.get\('\/api\/model-files'/);
  assert.match(SERVER, /app\.post\('\/api\/model-files'/);
  assert.match(INDEX, /id="kolModelFilesBtn"/);
  assert.match(APP, /function openKolModelFilesModal/);
});

/* ---------- 3+6) Link + görsel PLM Sync'e bağlandı ---------- */

/* v11.10 — v9.10'un "tek düğme" kararı kullanıcı tarafından GERİ ALINDI.
   O sürümde link ve görsel tek komutta birleştirilmişti; ölçülen sorun,
   yalnız link tazelemek isteyen kullanıcının istemeden binlerce görsel
   isteği başlatmasıydı. Artık üç varlık (link / görsel / dosya) bağımsız.
   Korunan regresyon: v9.10 öncesinin İKİ AYRI ESKİ uygulaması (kendi
   tarama ve indirme yollarıyla) geri gelmemelidir. */
test('v9.10 öncesinin eski ayrı komut GÖVDELERİ geri gelmedi', () => {
  for (const prefix of ['cp', 'orders', 'kol']) {
    assert.doesNotMatch(INDEX, new RegExp(`id="${prefix}PlmLinksBtn"`));
  }
  assert.doesNotMatch(APP, /function syncMissingPlmLinks/);
  assert.doesNotMatch(APP, /function runModelImageUpdate/);
  assert.doesNotMatch(APP, /function openModelImageUpdateChooser/);
  // Yeni bağımsız komutlar ORTAK alt seviyeyi kullanır; ikinci bir indirme
  // altyapısı klonlanmaz.
  assert.match(APP, /async function updateModelLinks\(mode,button/);
  assert.match(APP, /async function updateModelImages\(\{source=MODEL_ASSET_SOURCE_PLM/);
  assert.match(APP, /async function updateModelFiles\(mode,button/);
  assert.match(APP, /kolPlmSyncModelFilesRun\(button,targetRows,\{language\}\)/);
});

test('CP ve Orders tek PLM SYNC menüsünde PLM ve ASAS kategorilerini sunar', () => {
  for (const prefix of ['cp', 'orders']) {
    assert.match(INDEX, new RegExp(`id=\"${prefix}PlmSyncBtn\"`));
    assert.match(INDEX, new RegExp(`id=\"${prefix}PlmSyncMenu\"`));
    assert.match(INDEX, new RegExp(`data-plm-sync-category=\"plm\" data-plm-sync-page=\"${prefix}\"`));
    assert.match(INDEX, new RegExp(`data-plm-sync-category=\"asas\" data-plm-sync-page=\"${prefix}\"`));
  }
  assert.match(APP, /\['cpPlmSyncBtn','cpPlmSyncMenu'\]/);
  assert.match(APP, /\['ordersPlmSyncBtn','ordersPlmSyncMenu'\]/);
  assert.match(APP, /const collection=page==='kol';/);
  assert.match(APP, /runPlmUpdateFlow\(page,action,root,scope\)/);
  assert.doesNotMatch(APP, /This page updates PLM model images only/);
});

test('CP/Orders link işlemi görsel/dosya işi BAŞLATMAZ ve tablo alanı YAZMAZ', () => {
  const start = APP.indexOf('async function updateModelLinks(mode,button');
  const end = APP.indexOf('/* --- 2) MODEL GÖRSELLERİ', start);
  assert.ok(start >= 0 && end > start, 'updateModelLinks bulunamadı');
  const block = APP.slice(start, end);
  assert.match(block, /\/api\/plm-style-links\/sync-links/);
  // VARLIK BAĞIMSIZLIĞI: link komutunun gövdesinde görsel ya da dosya
  // isteği geçmemeli.
  assert.doesNotMatch(block, /import-plm|import-asas|plmSyncImagesStep|updateModelImages|model-files/);
  // Koleksiyon'un alan yazma motoru bu yola HİÇ karışmamalı.
  assert.doesNotMatch(block, /kolBuildPlmImportPlan|kolApplyApprovedPlmUpdate|saveKolRows/);
});

test('görsel işlemi link/dosya işi BAŞLATMAZ', () => {
  const start = APP.indexOf('async function updateModelImages({source=MODEL_ASSET_SOURCE_PLM');
  const end = APP.indexOf('function openModelAssetProgress', start);
  assert.ok(start >= 0 && end > start, 'updateModelImages bulunamadı');
  const block = APP.slice(start, end);
  assert.match(block, /import-asas.*import-plm|import-plm/);
  assert.doesNotMatch(block, /sync-links|plmSyncLinksStep|updateModelLinks|model-files/);
});

test('Koleksiyon PLM Sync linki ikinci bir taramaya gerek kalmadan tazeler', () => {
  // Sunucu, upsert sonrası GÜNCEL TAM link deposunu döndürür…
  assert.match(SERVER, /let styleLinks = null;/);
  assert.match(SERVER, /styleLinks = upsertPlmStyleLinks\(collected\.links, req\.currentUser\)/);
  // Korunan davranış styleLinks'in AYNI yanıtta dönmesidir; aradaki alanların
  // (ör. tanı izi) sayısı bu sözleşmenin parçası değildir.
  assert.match(SERVER, /scannedRows: collected\.scannedRows,/);
  assert.match(SERVER, /styleLinks, jobId: fetchRun\.job\.id,/);
  // …istemci de onu doğrudan uygular.
  assert.match(APP, /if\(fetchResult\.styleLinks\)applyPlmStyleLinksPayload\(fetchResult\.styleLinks\)/);
});

test('Koleksiyon PLM Sync alan değişikliği olmasa BİLE görsel adımını çalıştırır', () => {
  const start = APP.indexOf('async function kolPlmSyncRun');
  const end = APP.indexOf('async function kolPlmSyncButtonRun', start);
  const block = APP.slice(start, end);
  // "hepsi güncel" erken dönüş yolunda da görsel adımı var.
  const earlyReturn = block.indexOf('if(!summary.changed.length){');
  const imageInEarly = block.indexOf('kolPlmSyncImageStep', earlyReturn);
  assert.ok(earlyReturn >= 0 && imageInEarly > earlyReturn, 'erken dönüşte görsel adımı yok');
  // Görsel hatası alan güncellemesini geri aldırmamalı.
  assert.match(APP, /async function kolPlmSyncImageStep[\s\S]{0,400}?catch\(err\)\{ return \{saved:0/);
});

test('ASAS görsel kaynağı birleşik PLM SYNC menüsünde korunur ve kaynak seçimi sıkı kalır', () => {
  for (const prefix of ['cp', 'orders', 'kol']) {
    assert.match(INDEX, new RegExp(`data-plm-sync-category=\"asas\" data-plm-sync-page=\"${prefix}\"`));
  }
  assert.match(SERVER, /app\.post\('\/api\/model-images\/import-asas'/);
  const categoryStart=APP.indexOf('async function openPlmSyncCategoryPanel');
  const categoryBlock=APP.slice(categoryStart, APP.indexOf("document.addEventListener('click'", categoryStart));
  assert.match(categoryBlock, /if\(category==='asas'\)/);
  assert.match(categoryBlock, /updateModelImages\(\{source:'asas',mode:action,button:root,scope\}\)/);
  const imageStart=APP.indexOf('async function updateModelImages');
  const imageBlock=APP.slice(imageStart, APP.indexOf('function openModelAssetProgress', imageStart));
  assert.match(imageBlock, /source===MODEL_ASSET_SOURCE_ASAS\?'\/api\/model-images\/import-asas':'\/api\/model-images\/import-plm'/);
  assert.doesNotMatch(imageBlock, /sync-links/);
});

/* ---------- 4) Sütun seçimi ---------- */

test('yazmadan önce hangi sütunların yazılacağı kullanıcıya seçtirilir', () => {
  assert.match(APP, /function showPlmSyncColumnChooser\(mode,stats\)/);
  assert.match(APP, /function kolPlmSyncColumnStats\(summary\)/);
  assert.match(APP, /function kolPlmSyncFilterSummaryByColumns\(summary,keys\)/);
  const start = APP.indexOf('async function kolPlmSyncRun');
  const end = APP.indexOf('async function kolPlmSyncButtonRun', start);
  const block = APP.slice(start, end);
  const chooserAt = block.indexOf('showPlmSyncColumnChooser');
  const previewAt = block.indexOf('showPlmSyncPreview');
  assert.ok(chooserAt >= 0 && previewAt > chooserAt, 'sütun seçimi ön izlemeden ÖNCE olmalı');
  assert.match(block, /if\(choice\.cancelled\)return \{ok:true,applied:0,cancelled:true\}/);
});

test('seçilmeyen sütun ne önizlenir ne yazılır; modeli "değişmeyen"e taşır', () => {
  const start = APP.indexOf('function kolPlmSyncFilterSummaryByColumns');
  const end = APP.indexOf('/* Toplu Refresh', start);
  const block = APP.slice(start, end);
  assert.match(block, /item\.changes\.filter\(change=>keys\.has\(change\.key\)\)/);
  assert.match(block, /else unchanged\.push\(item\)/);
  // Yazma yalnız item.changes üzerinden yapıldığı için budama tek yeterli kontroldür.
  assert.match(APP, /item\.changes\.forEach\(change=>kolImportWriteField\(item\.target,change\.key,change\.to\)\)/);
});

test('sütun tercihi KAPATILANLAR olarak hatırlanır — yeni alanlar sessizce atlanmaz', () => {
  const start = APP.indexOf('function showPlmSyncColumnChooser');
  const end = APP.indexOf('function kolPlmSyncFilterSummaryByColumns', start);
  const block = APP.slice(start, end);
  assert.match(block, /const dismissed=new Set\(kolPlmSyncLoadColumnChoice\(\)\|\|\[\]\)/);
  assert.match(block, /stats\.filter\(stat=>!dismissed\.has\(stat\.key\)\)/);
  assert.match(block, /nextDismissed\.delete\(box\.dataset\.plmCol\)/);
  assert.match(CSS, /\.plmSyncColList\{/);
});

/* ---------- 5) LINE çeviriden muaf ---------- */

test('LINE çeviri zincirinden muaftır — PLM doğrudan doğru kabul edilir', () => {
  assert.match(APP, /const KOL_PLM_DIRECT_FIELDS=Object\.freeze\(\['line'\]\)/);
  assert.match(APP, /function kolPlmIsDirectField\(field\)/);
  // Uygulama: çeviri zinciri hiç çalışmaz, mode 'plm-direct' olur.
  assert.match(APP, /if\(kolPlmIsDirectField\(field\)\)\{\s*\n\s*row\[spec\.target\]=source;row\._plmTranslations\[field\]=\{source,target:source,mode:'plm-direct'\}/);
});

test('LINE için ne öneri üretilir ne de kullanıcıya soru sorulur', () => {
  // Öneri/öğrenme üretimi: line artık add() edilmiyor.
  const inferStart = APP.indexOf('function kolPlmInferTranslationSuggestions');
  const inferEnd = APP.indexOf('const KOL_PLM_TRANSLATION_FIELD_META', inferStart);
  const infer = APP.slice(inferStart, inferEnd);
  assert.doesNotMatch(infer, /add\('line'/);
  assert.match(infer, /unique\('category'\)\.forEach/);
  assert.match(infer, /unique\('license'\)\.forEach/);
  // Soru ekranı: line atlanır.
  const qStart = APP.indexOf('function kolPlmTranslationQuestions');
  const qEnd = APP.indexOf('function kolPlmConfidenceLabel', qStart);
  assert.match(APP.slice(qStart, qEnd), /if\(kolPlmIsDirectField\(field\)\)return;/);
  // Onaylanan eşleme bile line'ı ezemez.
  const aStart = APP.indexOf('function kolPlmApplyReviewedMappings');
  const aEnd = APP.indexOf('function kolPlmUniqueAsasValues', aStart);
  assert.match(APP.slice(aStart, aEnd), /if\(kolPlmIsDirectField\(mapping\.field\)\)return;/);
});

test('category ve license çeviriye tabi kalmaya devam eder', () => {
  assert.match(APP, /category:\{source:'categoryRaw',target:'urunTipi',asas:'category'\}/);
  assert.match(APP, /license:\{source:'brandToken',target:'lisans',asas:'license'\}/);
  // Excel importer'ın soru adımı Direct PLM'de de duruyor (v9.07 kök neden düzeltmesi).
  assert.match(APP, /const questions=kolPlmTranslationQuestions\(rows[,)]/);
  assert.match(APP, /showKolPlmTranslationReview\(questions\)/);
});

'use strict';
/* v9.11 — PLM teknik föyü (Technical Sheet Report) toplu indirme.

   Bu akış TAHMİN EDİLMEDİ; kullanıcının canlı CoreNectum oturumunda ağ
   trafiği dinlenerek ölçüldü:

     POST .../api/ReportOperations/CreateTechnicalSheetReport
          {"styleId":2498260,"languageId":2}
     → 200 application/pdf, doğrudan PDF gövdesi (~2.2 MB)

   Ölçümün en kritik sonucu: styleId, PLM Code'dan FARKLI bir sayıdır
   (PLM Code 2120176 → styleId 2498260). Yanlış styleId hata vermez, sessizce
   BAŞKA BİR MODELİN PDF'ini getirir — testlerin çoğu bu riski kilitler. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const APP = read('public/app-main.js');
const INDEX = read('public/index.html');
const SERVER = require('./helpers/server-source')();
const CONNECTOR = read('server/lib/agent-browser-connector.js');
const connector = require(path.join(root, 'server/lib/agent-browser-connector.js'));

/* Enjekte edilen JS metnini GERÇEKTEN çalıştırır (kaynak eşleştirmesi değil):
   tarayıcıda koşacak ifadeyi sahte fetch/FileReader ile koşup isteği yakalar. */
function runInjected(expression) {
  const calls = [];
  const fetchMock = async (url, init) => {
    calls.push({ url, init });
    return { ok: true, status: 200, headers: { get: () => 'application/pdf' }, blob: async () => ({ type: 'application/pdf' }) };
  };
  class AbortControllerMock { constructor() { this.signal = {}; } abort() {} }
  class FileReaderMock {
    set onload(fn) { this._fn = fn; setTimeout(() => { this.result = 'data:application/pdf;base64,JVBERi0xLjQK'; this._fn && this._fn(); }, 0); }
    get onload() { return this._fn; }
    set onerror(_) {}
    readAsDataURL() {}
  }
  const promise = Function('fetch', 'setTimeout', 'AbortController', 'FileReader', 'return ' + expression)(
    fetchMock, setTimeout, AbortControllerMock, FileReaderMock);
  return promise.then(result => ({ result, calls }));
}

test('istek gövdesi ölçülen canlı trafikle BİREBİR aynı (EN = languageId 2)', async () => {
  const { calls } = await runInjected(connector.coreNectumTechnicalSheetExpression('2498260', 'en'));
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://mym-api.lcwaikiki.com/lcw/live/corenectum/service/api/ReportOperations/CreateTechnicalSheetReport');
  assert.equal(calls[0].init.method, 'POST');
  assert.deepEqual(JSON.parse(calls[0].init.body), { styleId: 2498260, languageId: 2 });
  // Oturum çerezleri olmadan CoreNectum 401 döner.
  assert.equal(calls[0].init.credentials, 'include');
});

test('TR ayrı bir languageId gönderir — dil seçimi gerçekten isteğe yansır', async () => {
  const { calls } = await runInjected(connector.coreNectumTechnicalSheetExpression('2498260', 'tr'));
  assert.deepEqual(JSON.parse(calls[0].init.body), { styleId: 2498260, languageId: 1 });
  assert.equal(connector.coreNectumTechnicalSheetLanguageId('tr'), 1);
  assert.equal(connector.coreNectumTechnicalSheetLanguageId('en'), 2);
  // Bilinmeyen/boş dil sessizce EN'e düşer, patlamaz.
  assert.equal(connector.coreNectumTechnicalSheetLanguageId('de'), 2);
  assert.equal(connector.coreNectumTechnicalSheetLanguageId(''), 2);
});

test('styleId asla PLM ID varsayılmaz — geçersizse istek HİÇ üretilmez', () => {
  assert.throws(() => connector.coreNectumTechnicalSheetExpression('', 'en'), /Style ID/);
  assert.throws(() => connector.coreNectumTechnicalSheetExpression('abc', 'en'), /Style ID/);
  assert.throws(() => connector.coreNectumTechnicalSheetExpression('0', 'en'), /Style ID/);
});

test('Style ID olmayan model tarayıcı hiç açılmadan raporlanır', async () => {
  // Hepsi styleId'siz: ensureContext'e (gerçek Edge bağlantısı) hiç gidilmemeli,
  // yoksa test ortamında bağlantı hatası alırdık. Temiz dönmesi bunu kanıtlar.
  const out = await connector.downloadCoreNectumTechnicalSheets('user-1', [
    { plmId: '2120176', styleId: '' },
    { plmId: '2119399', styleId: null },
  ], { language: 'en' });
  assert.equal(out.files.length, 0);
  assert.equal(out.failed.length, 2);
  assert.equal(out.requested, 2);
  for (const item of out.failed) assert.equal(item.code, 'CORENECTUM_STYLE_ID_REQUIRED');
});

test('iptal edilen teknik föy işi Edge bağlantısı açmadan sonlanır', async () => {
  await assert.rejects(
    connector.downloadCoreNectumTechnicalSheets('user-1', [
      { plmId: '2120176', styleId: '2498260' },
    ], { language: 'en', isCancelled: () => true }),
    error => error && error.code === 'PLM_JOB_CANCELLED'
  );
});

test('teknik föy partisi tarayıcı sayfası yerine doğrudan CoreNectum API client kullanır', () => {
  const start = CONNECTOR.indexOf('async function downloadCoreNectumTechnicalSheets');
  const end = CONNECTOR.indexOf('async function coreNectumStyleListReady', start);
  assert.ok(start >= 0 && end > start);
  const block = CONNECTOR.slice(start, end);
  assert.doesNotMatch(block, /pageForCoreNectumReport|coreNectumBulkApiScan|coreNectumListCapture/);
  assert.match(block, /coreNectumApiClient\.postBuffer\(ownerId,CORENECTUM_TECHNICAL_SHEET_API/);
  assert.match(block, /for\(let index=0;index<pending\.length;index\+=1\)/);
  assert.match(block, /throwIfCancelled\(\)/, 'iptal kontrolü parti ve istek sonrasında korunmalı');
  assert.match(block, /CORENECTUM_API_TOKEN_REQUIRED/);
  assert.match(block, /CORENECTUM_API_TOKEN_INVALID/);
});

test('takılan PLM teknik föy isteği bir dakika içinde sonlandırılır', () => {
  assert.match(CONNECTOR, /CORENECTUM_TP_REQUEST_TIMEOUT_MS=60000/);
});

test('PDF olmayan yanıt dosya olarak kaydedilmez', () => {
  const start = CONNECTOR.indexOf('async function downloadCoreNectumTechnicalSheets');
  const end = CONNECTOR.indexOf('async function coreNectumStyleListReady', start);
  const block = CONNECTOR.slice(start, end);
  assert.match(block, /buffer\.subarray\(0,5\)\.toString\('ascii'\)!=='%PDF-'/);
  assert.match(block, /PLM_TP_INVALID_PDF/);
});

/* ---------- sunucu ucu ---------- */

/* The route and the Office technical sheet capability share one service
   (prepareTechnicalSheetItems + downloadTechnicalSheets); the route only
   validates the request and calls it. */
function modelFilesBlock() {
  const start = SERVER.indexOf('function prepareTechnicalSheetItems(');
  const route = SERVER.indexOf("app.post('/api/plm-sync/model-files'");
  const end = SERVER.indexOf("app.post('/api/plm-sync/model-files/status'");
  assert.ok(start >= 0 && route > start && end > route, 'rota yok');
  const routeBlock = SERVER.slice(route, end);
  assert.match(routeBlock, /prepareTechnicalSheetItems\(rawItems\)/);
  assert.match(routeBlock, /downloadTechnicalSheets\(req\.currentUser, items, language\)/);
  return SERVER.slice(start, end);
}

test('rota styleId\'yi PLM link deposundan çözer, istemciden almaz', () => {
  const block = modelFilesBlock();
  assert.match(block, /const links = loadPlmStyleLinks\(\)\.links \|\| \{\}/);
  assert.match(block, /styleId: link && link\.styleId \? String\(link\.styleId\) : ''/);
  // İstemcinin gönderdiği styleId'ye GÜVENİLMEZ; body'den okunmaz.
  assert.doesNotMatch(block, /raw\.styleId|raw && raw\.styleId/);
});

test('rota PLM Sync yetkisiyle çalışır (source yetkisi şart koşulmaz)', () => {
  const start = SERVER.indexOf("app.post('/api/plm-sync/model-files'");
  const head = SERVER.slice(start, start + 200);
  assert.match(head, /userAccess\.requireArea\('koleksiyon'\)/);
});

test('aynı PLM ID için önceki canonical föy dil fark etmeksizin değiştirilir, kullanıcı dosyalarına dokunulmaz', () => {
  const block = modelFilesBlock();
  // Canonical ownership PLM ID başına tektir; dil ikinci bir aktif referans yaratmaz.
  assert.match(block, /old\.modelKey === meta\.modelKey && old\.plmSource === 'technical-sheet'/);
  assert.doesNotMatch(block, /old\.plmLanguage === language/);
  assert.match(block, /plmSource: 'technical-sheet', plmLanguage: language/);
});

test('rota mevcut Dosyalar deposuna yazar (ayrı bir depo açmaz)', () => {
  const block = modelFilesBlock();
  assert.match(block, /readModelFilesIndex\(\)/);
  assert.match(block, /writeModelFilesIndex\(index\)/);
  assert.match(block, /resolveStoredFile\(MODEL_FILES_ROOT, storedName\)/);
  assert.match(block, /publicModelFileMeta\(item\)/);
});

test('rota operasyon merkezi iptalini teknik föy indiricisine taşır', () => {
  const block = modelFilesBlock();
  assert.match(block, /isCancelled: job\.cancelled/);
  assert.match(SERVER, /status: cancelled\(\) \? 'cancelled' : 'failed'/);
});

/* ---------- istemci ---------- */

test('dosya adı "PLM ID - MODEL ADI - SPECIAL CODE" biçiminde', () => {
  const start = APP.indexOf('function kolPlmSyncModelFileName');
  const end = APP.indexOf('function showPlmSyncLanguageChooser', start);
  assert.ok(start >= 0 && end > start);
  const block = APP.slice(start, end);
  const fn = new Function('norm', `${block}\nreturn kolPlmSyncModelFileName;`)(v => String(v == null ? '' : v).trim());
  assert.equal(fn({ plmId: '2120176', modelKod: 'PSG-5-YD', specialCode: 'S7A1B2Z4' }), '2120176 - PSG-5-YD - S7A1B2Z4.pdf');
  // Boş alanlar " -  - " üretmemeli.
  assert.equal(fn({ plmId: '2120176', modelKod: 'PSG-5-YD', specialCode: '' }), '2120176 - PSG-5-YD.pdf');
  assert.equal(fn({ plmId: '2120176', modelKod: '', specialCode: '' }), '2120176.pdf');
});

test('dil çalıştırma başına BİR kez sorulur, model başına değil', () => {
  const start = APP.indexOf('async function kolPlmSyncModelFilesRun');
  const end = APP.indexOf("/* Eski tek \"Model Dosyalarını PLM'den Çek\" düğmesi kaldırıldı;", start);
  const block = APP.slice(start, end);
  // Tek çağrı, üstelik satır döngüsünden ÖNCE.
  assert.equal((block.match(/showPlmSyncLanguageChooser\(\)/g) || []).length, 1);
  assert.ok(block.indexOf('showPlmSyncLanguageChooser') < block.indexOf('rows.map'));
  // Vazgeçilirse hiçbir istek atılmaz.
  assert.match(block, /if\(!language\)return \{ok:true,cancelled:true\}/);
  // Seçilen dil isteğe gerçekten konur.
  assert.match(block, /JSON\.stringify\(\{items,language\}\)/);
});

/* v11.10 — Model Dosyaları artık kendi başına bir işlemdir (Eksikleri
   Tamamla / Seçilenleri Yenile / Tümünü Yenile) ve görsel işi BAŞLATMAZ.
   Korunan regresyon değişmedi: komut YALNIZ Koleksiyon'dadır — teknik föy
   model düzeyi bir varlıktır ve CP/Orders'ta görüntülenecek yeri yoktur. */
test('Tech Pack işlemi yalnız Koleksiyon PLM akışında sunulur ve PLM ID seviyesinde canonical saklanır', () => {
  assert.match(APP, /function kolCanonicalTechnicalSheetKey\(row\)/);
  assert.match(APP, /plm-tp-\$\{plmId\}/);
  const chooserStart=APP.indexOf('function showPlmSyncPropertyChooser');
  const chooserEnd=APP.indexOf('function collectionPlmRowsForScope', chooserStart);
  const chooser=APP.slice(chooserStart,chooserEnd);
  assert.match(chooser, /key:'files'[\s\S]*?Model Files/);
  const categoryStart=APP.indexOf('async function openPlmSyncCategoryPanel');
  const categoryEnd=APP.indexOf("document.addEventListener('click'", categoryStart);
  const category=APP.slice(categoryStart,categoryEnd);
  assert.match(category, /const collection=page==='kol'/);
  assert.match(category, /runPlmUpdateFlow\(page,action,root,scope\)/);
  assert.doesNotMatch(INDEX, /id=\"cpModelFiles(?:Missing|Selected|All)Btn\"/);
  assert.doesNotMatch(INDEX, /id=\"ordersModelFiles(?:Missing|Selected|All)Btn\"/);
  assert.match(APP, /showPlmSyncLanguageChooser\(/);
});

test('hedef satırlar Dosyalar ekranıyla aynı kuralı izler (seçim varsa seçim)', () => {
  const start = APP.indexOf('function kolPlmSyncModelFileRows');
  const end = APP.indexOf('async function kolPlmSyncModelFilesRun', start);
  const block = APP.slice(start, end);
  assert.match(block, /kolRows\.filter\(row=>selectionHasId\(kolSelected,row\.id\)\)/);
  assert.match(block, /selected\.length\?selected:filteredKol\(\)/);
  // PLM ID'si olmayan satır hiç gönderilmez.
  assert.match(block, /filter\(row=>kolPlmNormalizeId\(row&&row\.plmId\)\)/);
});

test('Style ID eksikliği kullanıcıya ayrı ve çözümüyle birlikte bildirilir', () => {
  const start = APP.indexOf('async function kolPlmSyncModelFilesRun');
  const end = APP.indexOf("/* Eski tek \"Model Dosyalarını PLM'den Çek\" düğmesi kaldırıldı;", start);
  const block = APP.slice(start, end);
  assert.match(block, /item\.code==='CORENECTUM_STYLE_ID_REQUIRED'/);
  assert.match(block, /model linklerini alın/);
});

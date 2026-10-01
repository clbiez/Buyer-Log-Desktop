'use strict';

/* v7.0.192 — PLM NUMUNE TALEPLERİ (CoreNectum Requests sekmesi) → Buyer Log
 *
 * Kullanıcı talebi: PLM'deki Requests sayfasındaki numune onay süreçleri
 * (Artwork / Fit Sample / Perfect Sign Off …) PLM Sync ile Buyer Log'a
 * aktarılsın. Karar: CP kontrol listesindeki PPS / S-Off / kritik numune /
 * Artwork soruları PLM kanıtıyla kendiliğinden cevaplanır; model bazında
 * talep listesi sağ tık penceresinde görünür.
 *
 * Korunan kusurlar:
 * 1) Tahmini uç nokta / gövde: yalnız canlı ölçülen GetRequestList biçimi.
 * 2) Yanlış styleId ile BAŞKA modelin taleplerinin yazılması.
 * 3) Başarısız isteğin eski veriyi silmesi.
 * 4) PLM'de talep YOKKEN sorunun "onaylı" ya da "eksik" sayılması.
 * 5) Reddedilip yeni iterasyonda açılan talebin eski onayla kapanması.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const Engine = require('../public/plm-sample-requests-engine.js');
const requestApi = require('../server/lib/corenectum-request-api.js');
const syncLib = require('../server/lib/plm-sample-request-sync.js');
const storeLib = require('../server/lib/plm-sample-requests-store.js');
const Checklist = require('../public/cp-checklist-engine.js');

const ROOT = path.resolve(__dirname, '..');
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8');

/* Kullanıcının kendi CoreNectum oturumunda yakalanan GERÇEK yanıt (kısaltılmış). */
function record(over) {
  return {
    requestId: 1077255, styleId: 2366351, requestCode: 6156522, itemCode: '2081327', itemName: 'BARCHA-4-YD',
    requestStatusId: 14, requestStatusName: 'Approved / Completed',
    requestTypeId: 5, requestTypeName: 'Sample', requestSubTypeId: 146, requestSubTypeName: 'Artwork ',
    supplierName: 'SAKTHI INFRA TEX PRIVATE LIMITED', responsibleUserName: 'SAKTHI INFRA TEX PRIVATE LIMITED',
    approverUserName: '', iteration: 1, sizeName: '',
    createdDate: '2026-09-08T15:15:27.350Z', approvedDate: null, requestDate: null, modifiedDate: '2026-09-09T05:36:56.393Z',
    ...over,
  };
}
const LIVE_PAYLOAD = {
  data: {
    coreNectumResultData: {
      requestListResult: [
        record(),
        record({ requestId: 1077148, requestCode: 6156415, requestStatusId: 9, requestStatusName: 'In Progress',
          requestTypeId: 12, requestTypeName: 'Fitting Requests', requestSubTypeId: 39, requestSubTypeName: 'Perfect Sign Off Fitting ',
          responsibleUserName: 'BILGEHAN KIRCA', createdDate: '2026-09-08T11:38:57.920Z', modifiedDate: null }),
        record({ requestId: 1074073, requestCode: 6153340, requestStatusId: 14, requestStatusName: 'Approved / Completed',
          requestTypeId: 12, requestTypeName: 'Fitting Requests', requestSubTypeId: 12, requestSubTypeName: 'Fit Sample Fitting ',
          approverUserName: 'PRABAHARAN RANGASAMY', createdDate: '2026-09-02T06:11:08.647Z', modifiedDate: '2026-09-03T10:01:23.310Z' }),
      ],
      totalCount: 3,
    },
    success: true, message: '', statusType: 1,
  },
};

test('v7.0.192 GetRequestList gövdesi canlı ölçülen biçimle birebir aynı', () => {
  assert.equal(requestApi.GET_REQUEST_LIST_URL, 'https://mym-api.lcwaikiki.com/lcw/live/corenectum/service/api/Request/GetRequestList');
  assert.deepEqual(requestApi.requestListBody('2366351'), {
    pageNumber: 1, pageSize: 1000,
    searchCriteria: { columnNames: [], searchText: '' },
    filterCriterias: [{ filterColumnName: 'styleId', filterOperator: 0, filterValue: '2366351' }],
  });
  assert.throws(() => requestApi.requestListBody(''), /Style ID/);
  // Uç nokta izinli listede olmalı; aksi hâlde istemci isteği reddeder.
  assert.match(read('server/lib/corenectum-api-client.js'), /ALLOWED_ENDPOINTS = new Set\(\[[^\]]*requestApi\.GET_REQUEST_LIST_URL\]/);
});

test('v7.0.192 canlı yanıt normalize edilir ve alt tipler kontrol kalemlerine eşlenir', () => {
  const requests = requestApi.parseRequestList(LIVE_PAYLOAD, '2366351');
  assert.equal(requests.length, 3);
  const [artwork, soff, fit] = requests;
  assert.equal(artwork.requestCode, '6156522');
  assert.equal(artwork.plmId, '2081327');
  assert.equal(artwork.subTypeName, 'Artwork');
  assert.equal(artwork.milestone, 'artwork');
  assert.equal(artwork.status, 'approved');
  assert.equal(soff.milestone, 'soff', '"Perfect Sign Off Fitting" S/Off’tur, "Fitting" yüzünden numuneye düşmemeli');
  assert.equal(soff.status, 'open');
  assert.equal(fit.milestone, 'criticalSample');
  assert.equal(fit.approverUserName, 'PRABAHARAN RANGASAMY');

  const milestones = Engine.summarizeMilestones(requests);
  assert.equal(milestones.artwork.state, 'approved');
  assert.equal(milestones.soff.state, 'open');
  assert.equal(milestones.soff.requestCode, '6156415');
  assert.equal(milestones.criticalSample.state, 'approved');
  assert.equal(milestones.pps, undefined, 'PLM’de PPS talebi yoksa kanıt da yok');
});

test('v7.0.192 başka styleId’ye ait kayıt bu modele yazılmaz; sarmalayıcı değişse de kayıt bulunur', () => {
  const foreign = { data: { coreNectumResultData: { requestListResult: [record(), record({ requestCode: 1, styleId: 999 })] } } };
  assert.deepEqual(requestApi.parseRequestList(foreign, '2366351').map(item => item.requestCode), ['6156522']);
  const nested = { result: { page: { items: [record()] } } };
  assert.equal(requestApi.parseRequestList(nested, '2366351').length, 1);
});

test('v7.0.192 alt tip ve durum sınıflandırması: bilinmeyen durum ONAYLI sayılmaz', () => {
  assert.equal(Engine.classifyMilestone(null, 'PPS Fitting'), 'pps');
  assert.equal(Engine.classifyMilestone(null, 'Pre-Production Sample'), 'pps');
  assert.equal(Engine.classifyMilestone(null, 'Size Set Fitting'), 'criticalSample');
  assert.equal(Engine.classifyMilestone(null, 'Seal Sample'), 'criticalSample');
  assert.equal(Engine.classifyMilestone(null, 'Lab Dip'), '');
  assert.equal(Engine.classifyStatus(null, 'Rejected'), 'rejected');
  assert.equal(Engine.classifyStatus(null, 'Cancelled'), 'cancelled');
  assert.equal(Engine.classifyStatus(null, 'Waiting For Supplier'), 'open');
});

test('v7.0.192 reddedilip yeni iterasyonda açılan talep "açık"tır; iptal yok sayılır', () => {
  const base = { milestone: 'criticalSample', subTypeId: '12', subTypeName: 'Fit Sample Fitting' };
  const milestones = Engine.summarizeMilestones([
    { ...base, requestCode: '1', iteration: 1, status: 'rejected', statusName: 'Rejected', createdDate: '2026-08-01T00:00:00.000Z' },
    { ...base, requestCode: '2', iteration: 2, status: 'open', statusName: 'In Progress', createdDate: '2026-08-10T00:00:00.000Z' },
    { milestone: 'pps', subTypeId: '50', subTypeName: 'PPS', requestCode: '3', iteration: 1, status: 'cancelled', statusName: 'Cancelled' },
  ]);
  assert.equal(milestones.criticalSample.state, 'open');
  assert.equal(milestones.criticalSample.requestCode, '2');
  assert.equal(milestones.pps, undefined, 'iptal edilen talep hiçbir şeyi kanıtlamaz');
  // Farklı alt tiplerden biri açıksa kalem açık kalır (Fit onaylı + Size Set açık).
  const mixed = Engine.summarizeMilestones([
    { ...base, requestCode: '4', iteration: 1, status: 'approved' },
    { milestone: 'criticalSample', subTypeId: '13', subTypeName: 'Size Set Fitting', requestCode: '5', iteration: 1, status: 'open' },
  ]);
  assert.equal(mixed.criticalSample.state, 'open');
});

function tempStore() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bl-plm-req-'));
  return storeLib.createStore(path.join(dir, 'plm-sample-requests.json'));
}

function fakeDeps(over) {
  const calls = [];
  const store = tempStore();
  const upserted = [];
  return {
    calls, upserted, store,
    deps: {
      normalizePlmId: value => Engine.numericId(value),
      loadLinks: () => ({ links: { 2081327: { plmId: '2081327', styleId: '2366351' } } }),
      upsertLinks: links => upserted.push(...links),
      store,
      postJson: async (url, body) => {
        calls.push({ url, body });
        if (url === requestApi.GET_REQUEST_LIST_URL) return LIVE_PAYLOAD;
        // GetStyleList: 2081328 → styleId 2366352
        return { data: { coreNectumResultData: { styleListResult: [{ plmCode: 2081328, styleId: 2366352, styleName: 'OTHER' }] } } };
      },
      ...over,
    },
  };
}

test('v7.0.192 senkron: styleId link deposundan, eksikse ölçülmüş GetStyleList ile çözülür', async () => {
  const ctx = fakeDeps({
    postJson: async (url, body) => {
      ctx.calls.push({ url, body });
      if (url === requestApi.GET_REQUEST_LIST_URL) {
        const styleId = body.filterCriterias[0].filterValue;
        return styleId === '2366351' ? LIVE_PAYLOAD : { data: { coreNectumResultData: { requestListResult: [], totalCount: 0 } } };
      }
      return { data: { coreNectumResultData: { styleListResult: [{ plmCode: 2081328, styleId: 2366352, styleName: 'OTHER' }] } } };
    },
  });
  const summary = await syncLib.syncSampleRequests(['2081327', '2081328', '9999999', 'x'], ctx.deps);
  assert.equal(summary.checked, 3);
  assert.equal(summary.synced, 2);
  assert.equal(summary.withRequests, 1);
  assert.equal(summary.requestCount, 3);
  assert.deepEqual(summary.notFound, ['9999999'], 'PLM listesinde olmayan model tahmin edilmez');
  assert.deepEqual(ctx.upserted.map(item => [item.plmId, item.styleId]), [['2081328', '2366352']]);
  const stored = ctx.store.load().models;
  assert.equal(stored['2081327'].requests.length, 3);
  assert.deepEqual(stored['2081328'].requests, [], 'başarılı ama boş yanıt "PLM’de talep yok" olarak yazılır');
  assert.ok(stored['2081328'].fetchedAt);
});

test('v7.0.192 başarısız istek eski veriyi silmez; yetki hatası işi durdurur ama alınanı kaydeder', async () => {
  const ctx = fakeDeps();
  await syncLib.syncSampleRequests(['2081327'], ctx.deps);
  assert.equal(ctx.store.load().models['2081327'].requests.length, 3);

  ctx.deps.postJson = async () => { throw Object.assign(new Error('HTTP 500'), { code: 'CORENECTUM_API_HTTP_ERROR' }); };
  const failed = await syncLib.syncSampleRequests(['2081327'], ctx.deps);
  assert.equal(failed.synced, 0);
  assert.equal(failed.failed[0].plmId, '2081327');
  assert.equal(ctx.store.load().models['2081327'].requests.length, 3, 'eski veri korunmalı');

  ctx.deps.postJson = async () => { throw Object.assign(new Error('401'), { code: 'CORENECTUM_API_TOKEN_INVALID' }); };
  await assert.rejects(() => syncLib.syncSampleRequests(['2081327'], ctx.deps), err => err.code === 'CORENECTUM_API_TOKEN_INVALID');
});

/* ------------------------------------------------ CP kontrol listesi kanıtı */
function analysis(over) {
  return {
    orderKey: '8001|MODEL-1|C1', stage: 'PRODUCTION', daysToLoad: 20, orderAgeDays: 60,
    plannedLoadDate: 20000, qty: 1000, ...over,
  };
}
const milestones = Engine.summarizeMilestones(requestApi.parseRequestList(LIVE_PAYLOAD, '2366351'));
const plmEvidence = (_analysis, itemId) => Engine.evidenceFor(milestones, itemId);

test('v7.0.192 PLM onayı soruyu kapatır; açık talep soruyu PLM durumuyla açık tutar; talep yoksa soru sorulur', () => {
  const settings = Checklist.normalizeSettings(null);
  assert.ok(Checklist.ITEM_BY_ID.artwork, 'Artwork kontrolü eklendi');
  const plain = Checklist.openItems(analysis(), { settings, answers: {} }).map(item => item.id);
  assert.ok(['pps', 'soff', 'artwork'].every(id => plain.includes(id)), 'kanıt yokken sorular eskisi gibi sorulur');

  const open = Checklist.openItems(analysis(), { settings, answers: {}, plmEvidence });
  const ids = open.map(item => item.id);
  assert.ok(!ids.includes('artwork'), 'PLM’de onaylı Artwork → soru kapanır');
  assert.ok(ids.includes('soff'), 'PLM’de açık S/Off → soru açık kalır');
  assert.equal(open.find(item => item.id === 'soff').plm.state, 'open');
  assert.ok(ids.includes('pps'), 'PLM’de PPS talebi yok → soru sorulmaya devam eder (cevapsız ≠ eksik)');
  assert.equal(open.find(item => item.id === 'pps').plm, null);

  const state = Checklist.stateFor(analysis(), { settings, answers: {}, plmEvidence });
  assert.equal(state.artwork, 'answered');
  assert.equal(state.soff, 'open');
});

test('v7.0.192 özet PLM ile kapananları ve PLM’de açık olanları ayrıca sayar; kullanıcı cevabı önceliklidir', () => {
  const settings = Checklist.normalizeSettings(null);
  const a = analysis();
  const answers = { [Checklist.answerKey(a.orderKey, 'soff')]: Checklist.makeAnswer('done', a, {}) };
  const summary = Checklist.summarize([a], { settings, answers, plmEvidence });
  assert.ok(!summary.items.some(item => item.id === 'soff'), 'kullanıcının cevabı PLM açık olsa da soruyu susturur');
  assert.ok(!summary.items.some(item => item.id === 'artwork'));
  assert.equal(summary.plmAnsweredTotal, 1, 'Artwork PLM onayıyla kapandı');
  assert.ok(summary.answeredTotal >= 2);

  const withOpen = Checklist.summarize([a], { settings, answers: {}, plmEvidence });
  assert.equal(withOpen.items.find(item => item.id === 'soff').plmOpen, 1);
});

test('v7.0.192 kablolama: PLM Sync, CP, sağ tık menüsü, lazy yükleme ve sunucu kaydı bağlı', () => {
  const server = read('server/server.js');
  assert.match(server, /require\('\.\/routes\/plm-request-routes'\)\(app, \{/);
  const routes = read('server/routes/plm-request-routes.js');
  assert.match(routes, /app\.get\('\/api\/plm-requests'/);
  assert.match(routes, /app\.post\('\/api\/plm-requests\/sync'/);
  assert.match(routes, /withPlmJob\(req/);

  /* Kullanıcı kararı: numune CP aşamasında takip edilir; koleksiyon
     aşamasında numune çalışılmaz. Koleksiyon PLM Sync numune ÇEKMEZ,
     tetikleme CP PLM SYNC menüsündedir. */
  const app = read('public/app-main.js');
  const kolSync = app.slice(app.indexOf('async function kolPlmSyncRun('), app.indexOf('async function kolPlmSyncButtonRun('));
  assert.ok(kolSync.length > 100);
  assert.doesNotMatch(kolSync, /BLPlmSampleRequests|SampleRequest/, 'Koleksiyon PLM Sync numune talebi çekmemeli');
  assert.match(app, /async function cpPlmSampleRequestsRun\(button\)/);
  assert.match(app, /const rows=selected\.length\?selected:filteredCP\(\);/);
  assert.match(app, /api\.sync\(plmIds,\{scope:'cp'\}\)/);
  const html = read('public/index.html');
  const menuOf = id => (html.match(new RegExp(`id="${id}"[\\s\\S]*?\\n\\s*</div>\\s*\\n\\s*</div>`)) || [''])[0];
  const cpMenu = menuOf('cpPlmSyncMenu');
  assert.match(cpMenu, /id="cpPlmSampleRequestsBtn"/, 'buton CP PLM SYNC menüsünde');
  const kolMenu = menuOf('kolPlmSyncMenu');
  assert.ok(kolMenu.length > 50);
  assert.doesNotMatch(kolMenu, /SampleRequests/);

  const view = read('public/cp-overview-assistant.js');
  assert.equal((view.match(/plmEvidence\b/g) || []).length >= 3, true);
  assert.match(view, /addEventListener\('bl:plm-requests-changed'/);
  assert.match(view, /data-cpa-plm-requests-sync/);

  const ctxMenu = read('public/row-context-menu.js');
  assert.match(ctxMenu, /sampleRequests\.openForRow\(row, config\.module\)/);
  assert.match(ctxMenu, /config\.module !== 'collection' && sampleRequests\.plmIdOfRow/, 'sağ tık penceresi koleksiyonda gösterilmez');
  const perf = read('public/perf-runtime.js');
  assert.match(perf, /'plm-sample-requests-engine\.js','plm-sample-requests\.js','row-context-menu\.js'/);
  assert.match(read('public/plm-operations.js'), /'plm-requests':/);
});

/* Kullanıcı talebi: "CP'ye PLM Numune sütunu ekle". Sütun salt okunurdur ve
   değeri satıra YAZILMAZ (ASAS satırı/kayıt kirlenmez); PLM senkronundan sonra
   aynı satır nesnesi yeni değeri okur. */
test('v7.0.192 CP PLM Numune sütunu: tanımlı, salt okunur ve kayda girmeyen erişimci', () => {
  const app = read('public/app-main.js');
  assert.match(app, /\{k:'Priority', label:'Priority', type:'priority'[^\n]*\n[^\n]*\n[^\n]*\n  \{k:'PLM Numune', label:'PLM Numune', type:'plmSample'/);
  assert.match(app, /case 'plmSample': return plmSampleCellHtml\(r,tableKey\);/);
  assert.match(app, /if\(c\.type==='plmSample'\) return norm\(v\);/);
  // Hem ham satırlar hem Partial View kopyaları erişimciyi taşır.
  assert.match(app, /ensurePlmSampleAccessors\(state\.cp\.rows\);\n  const source=partialViewRows\('cp',state\.cp\.rows\);ensurePlmSampleAccessors\(source\);/);
  assert.match(app, /ensurePlmSampleAccessors\(state\.orders\.rows\);\n  const source=partialViewRows\('orders',state\.orders\.rows\);ensurePlmSampleAccessors\(source\);/);
  assert.match(app, /window\.addEventListener\('bl:plm-requests-changed'/);

  // Erişimci davranışı: kaynak koddaki fonksiyon izole çalıştırılır.
  const start = app.indexOf("const PLM_SAMPLE_COL_KEY='PLM Numune';");
  const end = app.indexOf('function plmSampleCellHtml(');
  const window = { BLPlmSampleRequests: { columnText: row => (row['PLM ID'] === 2081327 ? 'S/Off: Açık · Artwork: Onaylı' : '') } };
  const ensure = new Function('window', `${app.slice(start, end)}; return ensurePlmSampleAccessors;`)(window);
  const row = { 'PLM ID': 2081327, 'Order Code': 1 };
  ensure([row]);
  assert.equal(row['PLM Numune'], 'S/Off: Açık · Artwork: Onaylı');
  assert.ok(!Object.keys(row).includes('PLM Numune'), 'değer satırın kendi alanı olmamalı');
  assert.equal(JSON.stringify(row).includes('PLM Numune'), false, 'kayda/JSON’a girmemeli');
  window.BLPlmSampleRequests.columnText = () => 'S/Off: Onaylı';
  assert.equal(row['PLM Numune'], 'S/Off: Onaylı', 'senkron sonrası aynı satır güncel değeri okur');
});

test('v7.0.192 PLM Numune sütun metni: talep yoksa "Talep yok", senkron yoksa boş', () => {
  const src = read('public/plm-sample-requests.js');
  assert.match(src, /function columnParts\(row, moduleId\)/);
  assert.match(src, /if \(!entry\) return null;/, 'senkron yapılmamış model boş görünür');
  assert.match(src, /value\.parts\.length \? value\.parts\.map\(part => part\.text\)\.join\(' · '\) : L\('Talep yok', 'No request'\)/);
});

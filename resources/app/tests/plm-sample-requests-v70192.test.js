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
  assert.equal(state.artwork, 'approved', 'PLM onayı soruyu Approved durumuna kapatır');
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
  assert.match(app, /async function cpPlmSampleRequestsRun\(button,mode='all'\)/);
  /* v7.0.198 kullanıcı kararı: tablo filtresi örtük UYGULANMAZ; kapsam
     açık seçeneklerle seçilir (seçili / eksik / üretimdeki / tümü). */
  const target = app.slice(app.indexOf('function cpPlmSampleTargetRows('), app.indexOf('async function cpPlmSampleRequestsRun('));
  assert.doesNotMatch(target, /filteredCP\(/, 'filtrelenmiş tablo örtük kapsam olmamalı');
  assert.match(target, /if\(mode==='selected'\)return selectedCpRowsForAction\(\);/);
  assert.match(target, /if\(mode==='missing'\)return all\.filter\(row=>\{const id=api\.plmIdOfRow\(row,'cp'\);return id&&!api\.entryFor\(id\);\}\);/);
  assert.match(target, /if\(mode==='production'\)return all\.filter\(row=>api\.rowStage\(row\)==='PRODUCTION'\);/);
  assert.match(app, /api\.sync\(plmIds,\{scope:'cp'\}\)/);
  const html = read('public/index.html');
  const menuOf = id => (html.match(new RegExp(`id="${id}"[\\s\\S]*?\\n\\s*</div>\\s*\\n\\s*</div>`)) || [''])[0];
  const cpMenu = menuOf('cpPlmSyncMenu');
  // v7.0.198: tek menü girişi, PLM SYNC gibi adımlı kapsam penceresi.
  assert.match(cpMenu, /data-plm-sync-category="samples" data-plm-sync-page="cp"/);
  assert.doesNotMatch(cpMenu, /data-cp-plm-samples=/, 'menüde dört ayrı başlık olmamalı');
  const flowStart = app.indexOf("if(category==='samples'){");
  const flow = app.slice(flowStart, app.indexOf("const collection=page==='kol';", flowStart));
  for (const mode of ['all', 'selected', 'production', 'missing']) assert.match(flow, new RegExp(`\\{id:'${mode}'`));
  assert.match(flow, /confirmSelection:true/);
  assert.match(flow, /await cpPlmSampleRequestsRun\(root,action\);/);
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
  assert.match(perf, /'plm-sample-requests-engine\.js','plm-sample-requests\.js','plm-bom\.js','row-context-menu\.js'/);
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

/* v7.0.193 — PLM KAYIT KARIŞIKLIĞINA DAYANIKLILIK (kullanıcının canlı örneği:
   1165835 GRINCH-3-NY). Hata: Artwork 4609404 onaylıyken sonradan açılan
   "Evaluated" girişler Artwork'ü açık gösterdi; Perfect Pre Production
   Fitting 4614452 onaylıyken iterasyon 2 "Received" PPS'i açık gösterdi; PPS
   onaylıyken Fit Sample 4573869 "Received" kaldığı için Fit açık göründü. */
function grinchRequests() {
  const r = (requestCode, status, statusName, subTypeName, subTypeId, iteration, createdDate) => ({
    requestCode, status, statusName, subTypeName, subTypeId, iteration, createdDate,
    milestone: Engine.classifyMilestone(subTypeId, subTypeName),
  });
  return [
    r('4614717', 'open', 'Evaluated', 'Artwork', '146', 4, '2026-09-20T00:00:00.000Z'),
    r('4614454', 'open', 'Received', 'Perfect Pre Production Fitting', '0', 2, '2026-09-19T00:00:00.000Z'),
    r('4614452', 'approved', 'Approved / Completed', 'Perfect Pre Production Fitting', '0', 1, '2026-09-18T00:00:00.000Z'),
    r('4611322', 'open', 'Evaluated', 'Artwork', '146', 3, '2026-09-10T00:00:00.000Z'),
    r('4609804', 'open', 'Evaluated', 'Artwork', '146', 2, '2026-09-05T00:00:00.000Z'),
    r('4609404', 'approved', 'Approved / Completed', 'Artwork', '146', 1, '2026-09-01T00:00:00.000Z'),
    r('4573869', 'open', 'Received', 'Fit Sample Fitting', '12', 1, '2026-08-01T00:00:00.000Z'),
  ];
}

test('v7.0.193 onaylı giriş varsa sonradan açılan onaysız girişler dikkate alınmaz', () => {
  assert.equal(Engine.classifyMilestone('0', 'Perfect Pre Production Fitting'), 'pps');
  const m = Engine.summarizeMilestones(grinchRequests());
  assert.equal(m.artwork.state, 'approved');
  assert.equal(m.artwork.requestCode, '4609404');
  assert.equal(m.pps.state, 'approved');
  assert.equal(m.pps.requestCode, '4614452');
  assert.equal(m.artwork.requests.length, 4, 'tüm girişler pencerede görünmeye devam eder');
});

/* Kullanıcı tanımı: Fit (ölçü/kalıp/işçilik) ve S/Off (Artwork'ün baskı/nakış
   onayı) ayrı yürür; PPS hem Fit'i hem Artwork'ü içerir ve SON aşamadır. */
test('v7.0.193 aşama zinciri: PPS → Fit + S/Off + Artwork; S/Off → Artwork; Fit ile S/Off bağımsız', () => {
  const m = Engine.summarizeMilestones(grinchRequests());
  assert.equal(m.criticalSample.state, 'approved', 'PPS onaylıysa Fit onaylı kabul edilir');
  assert.equal(m.criticalSample.inferredFrom, 'pps');
  assert.equal(m.criticalSample.requests[0].requestCode, '4573869', 'Fit’in kendi PLM girişi korunur');
  assert.equal(m.soff.state, 'approved');
  assert.equal(m.soff.inferredFrom, 'pps');

  const one = (milestone, subTypeName, status) => Engine.summarizeMilestones([{ requestCode: '9', status, statusName: status, subTypeName, subTypeId: '0', milestone, iteration: 1 }]);
  const soffOnly = one('soff', 'Perfect Sign Off Fitting', 'approved');
  assert.equal(soffOnly.artwork.state, 'approved', 'S/Off Artwork’ün baskı/nakış onayıdır');
  assert.equal(soffOnly.artwork.inferredFrom, 'soff');
  assert.equal(soffOnly.pps, undefined, 'S/Off PPS’i onaylamaz (PPS son aşama)');
  assert.equal(soffOnly.criticalSample, undefined, 'S/Off Fit’ten bağımsız');

  const fitOnly = one('criticalSample', 'Fit Sample Fitting', 'approved');
  assert.deepEqual(Object.keys(fitOnly), ['criticalSample'], 'Fit onayı başka kalemi onaylamaz');

  assert.equal(one('pps', 'PPS', 'open').criticalSample, undefined, 'onaysız PPS alt aşamaları etkilemez');
});

test('v7.0.193 Sample Evaluation Status onaylıysa talep onaylı sayılır', () => {
  const base = record({ requestStatusId: 9, requestStatusName: 'In Progress' });
  assert.equal(Engine.normalizeRequest(base).status, 'open');
  assert.equal(Engine.normalizeRequest({ ...base, styleSampleEvaluationStatusName: 'Approved / Completed' }).status, 'approved');
  assert.equal(Engine.normalizeRequest({ ...base, styleSampleEvaluationStatusName: 'In Process' }).status, 'open');
  assert.equal(Engine.normalizeRequest({ ...base, styleSampleEvaluationStatusName: 'Rejected' }).status, 'open', 'değerlendirme reddi talep durumunu ezmez');
  assert.equal(Engine.normalizeRequest({ ...record(), styleSampleEvaluationStatusName: 'Approved / Completed' }).evaluationStatusName, 'Approved / Completed');
  // Saklı kayıt yeniden sınıflanırken değerlendirme de okunur.
  assert.match(read('server/lib/plm-sample-requests-store.js'), /engine\.requestStatus\(item\.statusId, item\.statusName, item\.evaluationStatusName\)/);
});

test('v7.0.193 Priority: Ex-factory’ye 21 gün kala PPS onayı yoksa ayrı sebep; eşik düzenlenebilir', () => {
  const Rules = require('../public/cp-rules-engine.js');
  const rule = Rules.DEFAULT_RULES.find(item => item.id === 'builtin_action_pps_exfactory');
  assert.ok(rule && rule.builtIn && rule.kind === 'priority');
  assert.equal(rule.reasonTr, 'Ex-factory yaklaşıyor, PPS onayı yok');
  const days = rule.conditions.find(c => c.field === '@daysToLoad' && c.operator === 'lte');
  assert.equal(days.value, 21);
  // v7.221: 'açık' = Pending ya da Reddedildi (reddedilen PPS de onay değildir).
  assert.ok(rule.conditions.some(c => c.field === '@checklist:pps' && c.operator === 'in' && c.value.includes('open') && c.value.includes('rejected')));
  const a = analysis({ daysToLoad: 18 });
  assert.ok(Rules.applyPriorityRules(a, [rule], { pps: 'open' }).matched.length, 'PPS açık → kural eşleşir');
  assert.equal(Rules.applyPriorityRules(a, [rule], { pps: 'approved' }).matched.length, 0, 'PPS onaylı → eşleşmez');
  assert.ok(Rules.applyPriorityRules(a, [rule], { pps: 'rejected' }).matched.length, 'PPS reddedildi → eşleşir');
  // Kullanıcı eşiği değiştirirse (kural düzenleyici) kaydı kazanır.
  const edited = JSON.parse(JSON.stringify(rule));
  const editedDays = edited.conditions.find(c => c.field === '@daysToLoad' && c.operator === 'lte');
  editedDays.value = 10; editedDays.right.value = 10; // kural düzenleyici sağ tarafı yazar
  const merged = Rules.mergeWithDefaults([edited]).find(item => item.id === rule.id);
  assert.equal(merged.conditions.find(c => c.operator === 'lte').value, 10);
  assert.equal(Rules.applyPriorityRules(a, [merged], { pps: 'open' }).matched.length, 0);
});

test('CP açılınca PLM numune verisi otomatik tazelenmez (yalnız kullanıcı butonuyla)', () => {
  /* Arka plan tazelemesi her CP açılışında üretimdeki tüm modelleri PLM'den
     çekip programı yavaşlatıyordu; kullanıcı kararıyla kaldırıldı. */
  const src = read('public/plm-sample-requests.js');
  assert.doesNotMatch(src, /autoRefreshStale/);
  assert.match(src, /const STALE_MAX_AGE_MS = 24 \* 3600 \* 1000;/);
  assert.match(src, /if \(rowStage\(row\) !== 'PRODUCTION'\) continue;/);
  const app = read('public/app-main.js');
  assert.doesNotMatch(app, /cpPlmSampleAutoRefresh|autoRefreshStale/);
  assert.match(app, /async function cpPlmSampleRequestsRun\(button,mode='all'\)/, 'elle çekim yolu korunur');
});

test('v7.0.193 üretimi bitmiş sipariş: tüm numune kalemleri onaylı; üretimdeki sipariş PLM’e göre', () => {
  const m = Engine.summarizeMilestones([{ requestCode: '7', status: 'open', statusName: 'Received', subTypeName: 'Artwork', subTypeId: '146', milestone: 'artwork', iteration: 1 }]);
  for (const stage of ['LOADING', 'SHORTAGE', 'IN_TRANSIT', 'CUSTOMS', 'IN_WAREHOUSE', 'AWAITING_RETAIL_TRANSFER']) {
    const out = Engine.applyOrderStage(m, stage);
    assert.ok(Engine.MILESTONES.every(key => out[key].state === 'approved'), stage);
    assert.equal(out.artwork.inferredFrom, 'stage');
    assert.equal(out.artwork.requestCode, '7', 'PLM girişi korunur');
  }
  assert.equal(Engine.applyOrderStage(null, 'IN_TRANSIT').pps.state, 'approved', 'PLM senkronu olmasa da');
  assert.equal(Engine.applyOrderStage(m, 'PRODUCTION'), m);
  assert.equal(Engine.applyOrderStage(m, 'UNKNOWN'), m, 'aşaması bilinmeyen sipariş onaylı sayılmaz');
  assert.equal(Engine.applyOrderStage(null, 'PRODUCTION'), null);

  // Kontrol listesi: yükleme aşamasındaki siparişte numune soruları kapanır.
  const evidence = (a, id) => Engine.evidenceFor(Engine.applyOrderStage(null, a.stage), id);
  const settings = Checklist.normalizeSettings(null);
  const ids = Checklist.openItems(analysis({ stage: 'LOADING' }), { settings, answers: {}, plmEvidence: evidence }).map(item => item.id);
  assert.ok(!['pps', 'soff', 'criticalSample', 'artwork'].some(id => ids.includes(id)));
  const prodIds = Checklist.openItems(analysis({ stage: 'PRODUCTION' }), { settings, answers: {}, plmEvidence: evidence }).map(item => item.id);
  assert.ok(prodIds.includes('pps'), 'üretimdeki siparişte soru sorulmaya devam eder');
});

test('v7.0.193 istemci: aşama kanonik business-rules’tan okunur, üretim sonrası tek rozet', () => {
  const src = read('public/plm-sample-requests.js');
  assert.match(src, /rules\.operationalStageOf\(row && row\.STATUS\)/);
  assert.match(src, /if \(Engine\.isPostProductionStage\(stage\)\) \{/);
  assert.match(src, /Engine\.evidenceFor\(orderMilestones\(plmId, stage\), itemId\)/);
});

/* v7.0.193 — Kullanıcı: "Üretim statüsünde olmayan bir sipariş yükleme ve
   depo işlemlerine geçmişse tüm numuneleri onaylıdır; onaysız üretim aşaması
   bitmez." Canlı ekranda gümrükteki siparişler yanlış göründü: kaynak
   "Customs & Port Operations" gönderiyordu ve kanonik aşama kuralı bunu
   UNKNOWN sınıflıyordu. Bu test GERÇEK istemci modülünü (vm) ekran
   görüntüsündeki satırlarla çalıştırır. */
function loadClientModule(models) {
  const vm = require('node:vm');
  const BR = require('../public/business-rules.js');
  const window = {
    BLPlmSampleRequestsEngine: Engine, BLBusinessRules: BR,
    addEventListener() {}, dispatchEvent() {},
  };
  const context = vm.createContext({
    window, appLang: 'tr', console, CustomEvent: class {},
    fetch: async () => ({ ok: true, json: async () => ({ models, revision: 1 }) }),
  });
  vm.runInContext(read('public/plm-sample-requests.js'), context);
  return window.BLPlmSampleRequests;
}

test('v7.0.193 kanonik aşama: "Customs & Port Operations" ve boşluklu tire gümrük sayılır', () => {
  const BR = require('../public/business-rules.js');
  assert.equal(BR.operationalStageOf('Customs & Port Operations 10.616'), 'CUSTOMS');
  assert.equal(BR.operationalStageOf('CUSTOMS & PORT OPERATIONS'), 'CUSTOMS');
  assert.equal(BR.operationalStageOf('Gümrük - Liman Operasyonları'), 'CUSTOMS');
  assert.equal(BR.operationalStageOf('Customs & Port Operations 2.031 | In Transit 2.716'), 'CUSTOMS');
});

test('v7.0.193 ekran örnekleri: üretim sonrası/sevk edilmiş sipariş tek "Onaylı" rozeti; üretimdeki sipariş PLM’e göre', async () => {
  const toReq = (code, st, sub, it = 1) => Engine.normalizeRequest({ requestCode: code, styleId: 1, requestStatusId: /Approved/.test(st) ? 14 : 0, requestStatusName: st, requestSubTypeName: sub, iteration: it });
  const models = {
    1165835: { plmId: '1165835', styleId: '1', fetchedAt: '2026-10-01T00:00:00Z', requests: grinchRequests() },
    1205431: { plmId: '1205431', styleId: '2', fetchedAt: '2026-10-01T00:00:00Z', requests: [toReq(1, 'Received', 'Perfect Pre Production Fitting'), toReq(2, 'Approved / Completed', 'Perfect Sign Off Fitting')] },
  };
  const api = loadClientModule(models);
  await api.load();
  const cases = [
    ['In Transit 1.234', 1165835],
    ['Customs & Port Operations 10.616', 1165835],
    ['Customs & Port Operations 1.761 | Awaiting Retail Transfer 3.186', 1165835],
    ['In Warehouse 3.572', 1165835],
    ['Loading Operations 1.378', 1165835],
    ['In Transit 3.277 | In Warehouse 1.588', 1165835],
    ['Gümrük-Liman Operasyonları', 9999999],
  ];
  for (const [status, plm] of cases) {
    assert.equal(api.columnText({ 'PLM ID': plm, STATUS: status }, 'cp'), 'Onaylı · Üretim sonrası', status);
  }
  // STATUS tanınmasa da sevk edilmiş miktar varsa onaylı.
  assert.equal(api.columnText({ 'PLM ID': 1205431, STATUS: '???', 'Shipment Quantity': 1200 }, 'cp'), 'Onaylı · Üretim sonrası');
  assert.equal(api.columnText({ 'PLM ID': 1205431, STATUS: '???', 'Shipment Quantity': '1.200' }, 'cp'), 'Onaylı · Üretim sonrası');
  // Üretimdeki sipariş: PLM’e göre (FORMULA-3-YD benzeri: PPS açık, S/Off onaylı → Artwork S/Off’tan onaylı).
  assert.equal(api.columnText({ 'PLM ID': 1205431, STATUS: 'In Production 5.012', 'Shipment Quantity': 0 }, 'cp'), 'PPS: Açık · S/Off: Onaylı · Artwork: Onaylı');
  // Üretimdeki GRINCH: tüm kalemler PLM onayı/zinciriyle onaylı.
  assert.equal(api.columnText({ 'PLM ID': 1165835, STATUS: 'Üretimde' }, 'cp'), 'PPS: Onaylı · S/Off: Onaylı · FIT/SIZE: Onaylı · Artwork: Onaylı');
  // Kontrol listesi: gümrükteki sipariş numune sorusu sormaz.
  const evidence = api.evidenceForAnalysis({ stage: 'UNKNOWN', sourceRow: { 'PLM ID': 9999999, STATUS: 'Customs & Port Operations 10.616' } }, 'pps');
  assert.equal(evidence && evidence.state, 'approved');
  // Eskiyen veri tespiti yalnız üretimdeki siparişleri hedefler.
  assert.deepEqual([...api.staleProductionPlmIds([{ 'PLM ID': 1, STATUS: 'Üretimde' }, { 'PLM ID': 2, STATUS: 'In Transit' }, { 'PLM ID': 3, STATUS: 'Üretimde', 'Shipment Quantity': 50 }])], ['1']);
});

'use strict';

/* PLM Sync hız/dayanıklılık paketi:
 *   - BOM deposu bellekte önbelleklenir, toplu uç yalnız özet taşır.
 *   - BOM senkronu iptal ve yetki bitişinde yeni istek başlatmaz, tamamlananı kaydeder.
 *   - LCW AI danışmaları sınırlı paralellikle yürür; BUSY'de geri çekilir.
 *   - Koleksiyon PLM Sync iki fazlıdır: alanlar hemen döner, BOM + AI arka plan işidir.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const DATA_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'buyerlog-two-phase-'));
process.env.BUYER_LOG_SERVER_DATA_ROOT = DATA_ROOT;

const ROOT = path.join(__dirname, '..');
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const { createStore, summaryEntry } = require('../server/lib/plm-bom-store');
const bomSync = require('../server/lib/plm-bom-sync');
const lcwaiConfig = require('../server/lib/lcwai/lcwai-config');

function bomPayload(styleId, components) {
  return { data: { coreNectumResultData: { styleBom: { styleId: Number(styleId), styleBomId: 1, createdDate: null, modifiedDate: null, styleBomComponents: components } }, success: true } };
}
function printComponent(overrides = {}) {
  return {
    styleBomComponentId: 11, componentId: 22, componentCode: 'B1', description: 'ÖN BEDEN / FRONT BODY',
    componentType: 'Trim', mainCategoryId: 1, mainCategoryName: 'Embellishment', categoryId: 21, categoryName: 'Print',
    categoryGroupId: 3, categoryGroupName: 'Pigment', quantity: 1, ...overrides,
  };
}
const ambiguous = () => printComponent({ componentCode: 'B-UNKNOWN', description: 'SPECIAL ART POSITION' });
const tmpStore = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'buyerlog-bom-cache-'));
  return { dir, store: createStore(path.join(dir, 'plm-bom.json')) };
};
const records = count => Array.from({ length: count }, (_, i) => ({ plmId: String(1000 + i), styleId: String(5000 + i), styleName: `M${i}` }));

test('BOM deposu dosya değişmedikçe yeniden ayrıştırılmaz; dış yazım önbelleği geçersiz kılar', () => {
  const { dir, store } = tmpStore();
  store.saveResults([{ plmId: '1', styleId: '9', fingerprint: 'a', placements: [], components: [printComponent()] }]);
  const first = store.load();
  assert.equal(store.load(), first, 'aynı dosya kimliği → aynı normalize nesne');
  const raw = fs.readFileSync(store.file, 'utf8');
  assert.doesNotMatch(raw, /\n {2}"/, 'depo girintisiz JSON yazılır');
  const parsed = JSON.parse(raw);
  parsed.models['2'] = { ...parsed.models['1'], plmId: '2', styleId: '10' };
  fs.writeFileSync(store.file, JSON.stringify(parsed));
  const future = new Date(Date.now() + 5000);
  fs.utimesSync(store.file, future, future);
  const reloaded = store.load();
  assert.notEqual(reloaded, first);
  assert.ok(reloaded.models['2'], 'dışarıdan yazılan kayıt okunur');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('saveResults paylaşılan önbellek nesnesini değiştirmez', () => {
  const { dir, store } = tmpStore();
  store.saveResults([{ plmId: '1', styleId: '9', fingerprint: 'a' }]);
  const before = store.load();
  const revision = before._revision;
  store.saveResults([{ plmId: '2', styleId: '10', fingerprint: 'b' }]);
  assert.equal(before._revision, revision, 'eski nesnenin revision değeri korunur');
  assert.equal(before.models['2'], undefined, 'eski nesneye yeni model eklenmez');
  assert.ok(store.load().models['2']);
  assert.equal(store.load()._revision, revision + 1);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('toplu özet yalnız Artwork/Fabric alanlarını taşır; bileşen listeleri taşınmaz', () => {
  const { dir, store } = tmpStore();
  store.saveResults([{
    plmId: '1', styleId: '9', fingerprint: 'a', fabric: 'Cotton',
    components: [printComponent()], fullComponents: [printComponent(), printComponent({ componentCode: 'L1' })],
    placements: [{ componentCode: 'B1', placement: 'front_body', printType: 'Pigment', count: 1, description: 'long text' }],
  }]);
  const summary = summaryEntry(store.entry('1'));
  assert.equal(summary.components, undefined);
  assert.equal(summary.fullComponents, undefined);
  assert.equal(summary.fabric, 'Cotton');
  assert.equal(summary.hasPrint, true);
  assert.deepEqual(Object.keys(summary.placements[0]).sort(), ['count', 'placement', 'placementEn', 'placementTr', 'printType']);
  assert.ok(JSON.stringify(summary).length < JSON.stringify(store.entry('1')).length / 2);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('iptal edilen BOM senkronu yeni istek başlatmaz ve tamamlananları kaydeder', async () => {
  const { dir, store } = tmpStore();
  let calls = 0, cancelled = false;
  const postJson = async (_url, body) => {
    calls += 1;
    if (calls >= 2) cancelled = true;
    return bomPayload(body.styleId, [printComponent()]);
  };
  const result = await bomSync.syncPlmBoms(records(10), { ownerId: 'u1', store, postJson, fetchConcurrency: 1, isCancelled: () => cancelled });
  assert.equal(result.stopped, 'cancelled');
  assert.equal(calls, 2, 'iptalden sonra yeni BOM isteği atılmaz');
  assert.equal(result.skipped, 8);
  assert.equal(result.failed.length, 0, 'iptalde atlananlar hata sayılmaz');
  assert.ok(store.entry('1000') && store.entry('1001'), 'tamamlanan BOM kaydedilir');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('yetki bitince kalan BOM istekleri atılmaz; atlananlar yetki koduyla raporlanır', async () => {
  const { dir, store } = tmpStore();
  let calls = 0;
  const postJson = async (_url, body) => {
    calls += 1;
    if (calls === 3) throw Object.assign(new Error('expired'), { code: 'CORENECTUM_API_TOKEN_INVALID' });
    return bomPayload(body.styleId, [printComponent()]);
  };
  const result = await bomSync.syncPlmBoms(records(10), { ownerId: 'u1', store, postJson, fetchConcurrency: 1 });
  assert.equal(result.stopped, 'auth');
  assert.equal(result.stopError.code, 'CORENECTUM_API_TOKEN_INVALID');
  assert.equal(calls, 3, 'ilk 401 sonrası yeni istek yok');
  assert.equal(result.fetched, 2);
  assert.equal(result.failed.length, 8);
  assert.ok(result.failed.every(item => item.code === 'CORENECTUM_API_TOKEN_INVALID'));
  assert.ok(store.entry('1000') && store.entry('1001'), 'yetki bitmeden okunanlar kaydedilir');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('LCW AI danışmaları sınırlı paralellikle yürür ve BUSY yanıtında yeniden denenir', async () => {
  const { dir, store } = tmpStore();
  let active = 0, peak = 0, asks = 0, busyOnce = true;
  const aiEngine = {
    async ask() {
      asks += 1;
      if (busyOnce) { busyOnce = false; throw Object.assign(new Error('busy'), { code: 'LCWAI_BUSY' }); }
      active += 1; peak = Math.max(peak, active);
      await new Promise(resolve => setTimeout(resolve, 15));
      active -= 1;
      return { text: JSON.stringify({ placements: [{ componentCode: 'B-UNKNOWN', placement: 'chest', confidence: 'high' }], confidence: 'high', notes: [] }), model: { key: 'm' } };
    },
  };
  const postJson = async (_url, body) => bomPayload(body.styleId, [ambiguous()]);
  const result = await bomSync.syncPlmBoms(records(6), { ownerId: 'u1', store, postJson, aiEngine, aiBusyDelayMs: 0 });
  assert.equal(result.aiConsulted, 6);
  assert.equal(result.aiResolved, 6, 'BUSY sonrası tekrar deneme başarılı');
  assert.equal(asks, 7);
  assert.equal(peak, bomSync.AI_CONCURRENCY, 'paralellik sınırı aşılmaz ama kullanılır');
  assert.ok(lcwaiConfig.LIMITS.maxConcurrentPerOwner > bomSync.AI_CONCURRENCY, 'kullanıcının LCW AI sohbetine bir slot kalır');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('AI üst sınırı paralel danışmada da aşılmaz', async () => {
  const { dir, store } = tmpStore();
  let asks = 0;
  const aiEngine = { async ask() { asks += 1; await new Promise(resolve => setTimeout(resolve, 5)); return { text: '{"placements":[],"confidence":"low","notes":[]}', model: { key: 'm' } }; } };
  const postJson = async (_url, body) => bomPayload(body.styleId, [ambiguous()]);
  const result = await bomSync.syncPlmBoms(records(8), { ownerId: 'u1', store, postJson, aiEngine, maxAiPerSync: 3 });
  assert.equal(asks, 3);
  assert.equal(result.aiConsulted, 3);
  assert.equal([...result.entries.values()].filter(entry => entry.ai.status === 'deferred').length, 5);
  fs.rmSync(dir, { recursive: true, force: true });
});

function fakeJobs() {
  const jobs = new Map();
  let seq = 0;
  const plmJobs = {
    create(_user, meta) { const id = `job${++seq}`; jobs.set(id, { id, ...meta, status: 'running', failures: [], cancel: false }); return jobs.get(id); },
    update(_user, id, patch) { Object.assign(jobs.get(id), patch); },
    addFailure(_user, id, failure) { jobs.get(id).failures.push(failure); },
    finish(_user, id, patch) { Object.assign(jobs.get(id), patch); },
    isCancelled(_user, id) { return jobs.get(id).cancel; },
    describe(_user, id) { return { ...jobs.get(id) }; },
  };
  async function withPlmJob(req, meta, fn) {
    const job = plmJobs.create(req.currentUser.id, meta);
    const cancelled = () => plmJobs.isCancelled(req.currentUser.id, job.id);
    try {
      const result = await fn({ id: job.id, report: patch => plmJobs.update(null, job.id, patch), fail: f => plmJobs.addFailure(null, job.id, f), cancelled });
      plmJobs.finish(null, job.id, { status: cancelled() ? 'cancelled' : 'succeeded' });
      return { job: plmJobs.describe(null, job.id), result };
    } catch (error) {
      plmJobs.finish(null, job.id, { status: cancelled() ? 'cancelled' : 'failed', error: error.message, code: error.code });
      throw error;
    }
  }
  return { jobs, plmJobs, withPlmJob };
}

test('iki fazlı PLM Sync alanları hemen döndürür; BOM arka plan işi olur ve iptal bayrağı iletilir', async () => {
  const { createPlmFetchService } = require('../server/routes/plm-sync-routes');
  const { jobs, plmJobs, withPlmJob } = fakeJobs();
  let connectorOptions = null;
  const service = createPlmFetchService({
    normalizePlmId: value => String(value || '').trim(),
    setModelOperationProgress() {}, clearModelOperationProgress() {},
    getModelImageSettings: () => ({}),
    upsertPlmStyleLinks: () => ({ links: {} }),
    userAccess: { appendAudit() {} },
    plmJobs, withPlmJob,
    bomAuthWait: { waitMs: 60, pollMs: 10 },
    agentBrowserConnector: {
      async collectCoreNectumStyleLinks(_owner, items, options) {
        connectorOptions = options;
        return { links: items.map(item => ({ plmId: item.plmId, styleId: '77' + item.plmId, styleName: 'X', productType: 'Single Style' })), failed: [], requested: items.length, scannedPages: 1, scannedRows: items.length, diagnostics: [] };
      },
    },
  });
  const result = await service.fetch({ id: 'u1' }, { plmIds: ['11', '12'], bomMode: 'background' }, { allowAi: true });
  assert.equal(typeof connectorOptions.isCancelled, 'function', 'Durdur bayrağı Style List taramasına iletilir');
  assert.equal(result.records.length, 2, 'alan kayıtları BOM beklemeden döner');
  assert.equal(result.bom.background, true);
  assert.equal(result.bom.requested, 0, 'Set Style olmayan modellerin BOM’u ön planda okunmaz');
  assert.ok(result.bomJob && result.bomJob.jobId, 'arka plan BOM işi başlatılır');
  assert.equal(result.bomJob.total, 2);
  // Test ortamında CoreNectum yetkisi yok: iş önce oturum yenilemesini bekler,
  // yeni yetki gelmezse çökmeden "başarısız" biter.
  await new Promise(resolve => setTimeout(resolve, 300));
  const job = jobs.get(result.bomJob.jobId);
  assert.equal(job.kind, 'plm-bom');
  assert.equal(job.status, 'failed');
  assert.equal(job.code, 'CORENECTUM_API_TOKEN_REQUIRED');
  assert.equal(job.failures.length, 2);
  assert.equal(job.processed, 0, 'yetki yokken atlanan modeller işlenmiş sayılmaz');
});

test('ilk faz durdurulduysa arka plan BOM işi başlatılmaz', async () => {
  const { createPlmFetchService } = require('../server/routes/plm-sync-routes');
  const { jobs, plmJobs, withPlmJob } = fakeJobs();
  const service = createPlmFetchService({
    normalizePlmId: value => String(value || '').trim(),
    setModelOperationProgress() {}, clearModelOperationProgress() {},
    getModelImageSettings: () => ({}), upsertPlmStyleLinks: () => null, userAccess: { appendAudit() {} },
    plmJobs, withPlmJob,
    agentBrowserConnector: {
      async collectCoreNectumStyleLinks(_o, items) {
        for (const job of jobs.values()) job.cancel = true; // kullanıcı Durdur'a bastı
        return { links: items.map(item => ({ plmId: item.plmId, styleId: '9', productType: 'Single Style' })), failed: [], requested: items.length, diagnostics: [] };
      },
    },
  });
  const result = await service.fetch({ id: 'u1' }, { plmIds: ['31'], bomMode: 'background' }, { allowAi: true });
  assert.equal(result.bomJob, null);
  assert.equal([...jobs.values()].some(job => job.kind === 'plm-bom'), false);
});

test('varsayılan (inline) fetch eski tek adımlı davranışı korur; arka plan işi açılmaz', async () => {
  const { createPlmFetchService } = require('../server/routes/plm-sync-routes');
  const { jobs, plmJobs, withPlmJob } = fakeJobs();
  const service = createPlmFetchService({
    normalizePlmId: value => String(value || '').trim(),
    setModelOperationProgress() {}, clearModelOperationProgress() {},
    getModelImageSettings: () => ({}), upsertPlmStyleLinks: () => null, userAccess: { appendAudit() {} },
    plmJobs, withPlmJob,
    agentBrowserConnector: { async collectCoreNectumStyleLinks(_o, items) { return { links: items.map(item => ({ plmId: item.plmId, styleId: '9' })), failed: [], requested: items.length, diagnostics: [] }; } },
  });
  const result = await service.fetch({ id: 'u1' }, { plmIds: ['21'] }, { allowAi: true });
  assert.equal(result.bomJob, null);
  assert.equal(result.bom.background, false);
  assert.equal(result.bom.requested, 1, 'BOM aynı istek içinde denenir');
  assert.equal([...jobs.values()].some(job => job.kind === 'plm-bom'), false);
});

test('Koleksiyon akışları arka plan BOM modunu ister ve işi izleyip Artwork’ü tazeler', () => {
  const app = read('public/app-main.js');
  assert.match(app, /kolPlmFetchWithRetry\(\{plmIds,bomMode:'background'/);
  assert.match(app, /kolPlmFetchWithRetry\(\{selectedOnly:true,existingBrowserOnly:true,bomMode:'background'/);
  assert.match(app, /function kolPlmWatchBomJob\(fetchResult\)/);
  assert.match(app, /\/api\/plm-jobs\/\$\{encodeURIComponent\(jobId\)\}/);
  assert.match(app, /BLCollectionArtworkDetail\?\.refresh\?\.\(\)/);
  assert.match(app, /BLCPPlmDetails\?\.refresh\?\.\(\)/);
  assert.match(app, /window\.BLPlmOpsRetry\['plm-bom'\]=window\.BLPlmOpsRetry\['plm-sync'\]/);
  // CP/Orders PLM detayları BOM'un kendisini istediği için inline kalır.
  assert.match(app, /body:JSON\.stringify\(\{plmIds:batch,scope:page,language:/);
  const ops = read('public/plm-operations.js');
  assert.match(ops, /'plm-bom': \{ tr: 'PLM BOM ve Artwork', en: 'PLM BOM and artwork' \}/);
});

test('Style List partileri gerçekten paralel ve sınırlı sorulur; ilk yetki hatasında yeni parti başlamaz', async t => {
  const client = require('../server/lib/corenectum-api-client');
  const styleApi = require('../server/lib/corenectum-style-api');
  const connector = require('../server/lib/agent-browser-connector');
  const original = client.postJson;
  t.after(() => { client.postJson = original; });
  let active = 0, peak = 0, calls = 0;
  client.postJson = async (_owner, _url, body) => {
    calls += 1; active += 1; peak = Math.max(peak, active);
    await new Promise(resolve => setTimeout(resolve, 10));
    active -= 1;
    const codes = String(body.filterCriterias[0].filterValue).split(',');
    return { data: { coreNectumResultData: { styleListResult: codes.map(code => ({ plmCode: Number(code), styleId: Number(code) + 900000, styleName: `S${code}` })) } } };
  };
  const items = Array.from({ length: 450 }, (_, i) => ({ plmId: String(2000 + i), needImage: false }));
  const result = await connector.collectCoreNectumStyleLinks('u1', items, {});
  assert.equal(result.links.length, 450);
  assert.equal(result.failed.length, 0);
  assert.equal(calls, 5, '450 PLM → 5 parti');
  assert.equal(peak, styleApi.STYLE_LIST_CONCURRENCY, 'eşzamanlılık kullanılır ama sınır aşılmaz');

  calls = 0;
  client.postJson = async () => { calls += 1; throw Object.assign(new Error('expired'), { code: 'CORENECTUM_API_TOKEN_INVALID' }); };
  await assert.rejects(connector.collectCoreNectumStyleLinks('u1', items, {}), { code: 'CORENECTUM_API_TOKEN_INVALID' });
  assert.ok(calls <= styleApi.STYLE_LIST_CONCURRENCY, 'yetki hatası bölünmez ve yeni parti başlatılmaz');
});

test('Style List iptali partiyi bölmez', () => {
  const connector = read('server/lib/agent-browser-connector.js');
  assert.match(connector, /'CORENECTUM_API_TOKEN_REQUIRED','PLM_JOB_CANCELLED'\]\.includes\(error\.code\)/);
});

test('CoreNectum durumu token değil yalnız bitiş zamanı verir; istemci süresi biten oturumu önceden yeniler', () => {
  const settings = require('../server/lib/corenectum-api-settings');
  const token = `h.${Buffer.from(JSON.stringify({ exp: 1893456000 })).toString('base64url')}.s`;
  assert.equal(settings.tokenExpiresAt(token), '2030-01-01T00:00:00.000Z');
  assert.equal(settings.tokenExpiresAt('opaque-token-without-jwt-shape'), '');
  settings.saveToken('u-exp', `${token}xxxxxxxxxxxxxxxxxxxx`);
  const status = settings.publicSettings('u-exp');
  assert.ok(!JSON.stringify(status).includes(token), 'durum yanıtı token taşımaz');
  settings.clearToken('u-exp');
  const app = read('public/app-main.js');
  assert.match(app, /async function coreNectumRefreshExpiringSession\(status\)/);
  assert.match(app, /runCoreNectumAutoAuth\(\{interactive:false,force:true\}\)/);
});

test('Set Style ilişki isteği sürerken durdurulursa çocuk istekleri başlatılmaz', async () => {
  const { dir, store } = tmpStore();
  let cancelled = false, posts = 0;
  const getJson = async () => {
    cancelled = true; // kullanıcı ilişki isteği uçuştayken Durdur'a bastı
    return { data: { coreNectumResultData: { setStyleChildStyleColorAssociations: [
      { rowId: 1, relatedStyleOptions: [{ setStyleId: 7, childStyleId: 71, childStylePlmCode: 701, childStyleName: 'A', perAssemblyCount: 1 }] },
      { rowId: 2, relatedStyleOptions: [{ setStyleId: 7, childStyleId: 72, childStylePlmCode: 702, childStyleName: 'B', perAssemblyCount: 1 }] },
    ] }, success: true } };
  };
  const postJson = async () => { posts += 1; return {}; };
  const result = await bomSync.syncPlmBoms([{ plmId: '700', styleId: '7', productType: 'Set Style' }], {
    ownerId: 'u1', store, getJson, postJson, isCancelled: () => cancelled,
  });
  assert.equal(posts, 0, 'çocuk metadata ve BOM istekleri gönderilmez');
  assert.equal(result.stopped, 'cancelled');
  assert.equal(result.skipped, 1);
  assert.equal(result.failed.length, 0);
  fs.rmSync(dir, { recursive: true, force: true });
});

function projectionHarness(file, globalName) {
  const vm = require('node:vm');
  const server = { revision: 1, entries: {} };
  const clock = { now: 1000 };
  const calls = [];
  const fetchImpl = async (_url, options) => {
    const body = JSON.parse(options.body);
    calls.push(body);
    if (body.ifRevision && body.ifRevision === server.revision) {
      return { ok: true, json: async () => ({ ok: true, notModified: true, entries: {}, revision: server.revision }) };
    }
    const entries = Object.fromEntries(body.plmIds.filter(id => server.entries[id]).map(id => [id, server.entries[id]]));
    return { ok: true, json: async () => ({ ok: true, entries, revision: server.revision }) };
  };
  const window = { document: { documentElement: { lang: 'tr' } }, addEventListener() {} };
  const FakeDate = function (...args) { return new Date(...args); };
  FakeDate.now = () => clock.now;
  const context = vm.createContext({ window, Date: FakeDate, Set, Map, Promise, Number, String, JSON, Array, Object, Math, fetch: fetchImpl, setTimeout, clearTimeout });
  vm.runInContext(read(file), context);
  return { api: window[globalName], server, clock, calls };
}

test('CP projeksiyonu: görünür kümeden çıkan eski kayıt revision kısa devresiyle bayat kalmaz', async () => {
  const { api, server, clock, calls } = projectionHarness('public/cp-plm-details.js', 'BLCPPlmDetails');
  const rowA = { 'PLM ID': '501' }, rowB = { 'PLM ID': '502' };
  server.entries = { 501: { styleId: '1', fabric: 'Eski kumaş' }, 502: { styleId: '2', fabric: 'B kumaş' } };
  await api.sync({ cpRows: [rowA] });
  assert.equal(rowA['Fabric (PLM)'], 'Eski kumaş');
  // A depoda güncellenir; kullanıcı yalnız B'yi görürken tazeleme olur.
  server.revision = 2; server.entries[501] = { styleId: '1', fabric: 'Yeni kumaş' };
  await api.sync({ cpRows: [rowB] });
  await api.refresh(); // yalnız B görünürken revision 2'ye ilerler
  await api.sync({ cpRows: [rowA] });
  assert.equal(rowA['Fabric (PLM)'], 'Yeni kumaş', 'kümeye geri dönen A yeniden okunur');
  // Depo değişmediyse bayatlık sonrası yalnız revision sorulur, ID'ler yeniden taşınmaz.
  clock.now += 61000; calls.length = 0;
  await api.sync({ cpRows: [rowA] });
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], { plmIds: [], ifRevision: 2 });
});

test('Koleksiyon Artwork projeksiyonu: görünür küme dışındaki kayıtlar revision ilerleyince atılır', () => {
  const column = read('public/collection-artwork-detail.js');
  assert.match(column, /for \(const id of \[\.\.\.state\.cache\.keys\(\)\]\) if \(!ids\.has\(id\)\) \{ state\.cache\.delete\(id\); state\.meta\.delete\(id\); \}/);
  assert.match(column, /if \(stale && !options\.force && !missingIds\(\)\.size && await unchangedSince\(state\.revision\)\)/);
});

test.after(() => { fs.rmSync(DATA_ROOT, { recursive: true, force: true }); });

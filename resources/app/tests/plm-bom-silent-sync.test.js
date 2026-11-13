'use strict';

/* CP / Orders sessiz arka plan PLM BOM senkronu.
 *   - allowAi:false sessiz koşuda ertelenmiş (deferred/failed) AI kaydı içerik
 *     değişmediyse yeniden yazılmaz (revizyon artmaz, CP/Orders boşuna çizmez).
 *   - Model başına okuma zamanı: daha eski başlamış okumanın sonucu, daha yeni
 *     okumanın kaydını ezemez (iptal edilen sessiz işin geç kaydı).
 *   - Sessiz iş oturum yenilemesini beklemez, görünür "bekleniyor" fazı yazmaz.
 *   - Sessiz servis: token yoksa iş başlamaz, AI yok, düşük eşzamanlılık,
 *     model başına günde en fazla bir okuma, iş kaydı geride kalmaz.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const DATA_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'buyerlog-silent-bom-'));
process.env.BUYER_LOG_SERVER_DATA_ROOT = DATA_ROOT;

const { createStore } = require('../server/lib/plm-bom-store');
const bomSync = require('../server/lib/plm-bom-sync');
const silent = require('../server/lib/plm-bom-silent-sync');

function bomPayload(styleId, components) {
  return { data: { coreNectumResultData: { styleBom: { styleId: Number(styleId), styleBomId: 1, createdDate: null, modifiedDate: null, styleBomComponents: components } }, success: true } };
}
function printComponent(overrides = {}) {
  return {
    styleBomComponentId: 11, componentId: 22, componentCode: 'B1', description: 'ÖN BEDEN / FRONT BODY',
    componentType: 'Trim', mainCategoryId: 1, mainCategoryName: 'Embellishment', categoryId: 21, categoryName: 'Print',
    categoryGroupName: 'Pigment', quantity: 1, ...overrides,
  };
}
const ambiguous = () => printComponent({ componentCode: 'B-UNKNOWN', description: 'SPECIAL ART POSITION' });
function tmpStore() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'buyerlog-silent-store-'));
  return { dir, store: createStore(path.join(dir, 'plm-bom.json')) };
}

test('allowAi:false sessiz koşu, AI ertelenmiş ama içeriği değişmemiş kaydı yeniden yazmaz', async () => {
  const { dir, store } = tmpStore();
  const records = [{ plmId: '501', styleId: '9501', fabric: '100% COTTON' }];
  const postJson = async (_url, body) => bomPayload(body.styleId, [ambiguous()]);
  const first = await bomSync.syncPlmBoms(records, { ownerId: 'u1', store, postJson, allowAi: false });
  assert.equal(first.changed, 1);
  assert.equal(store.entry('501').ai.status, 'deferred');
  const revision = store.load()._revision;

  const second = await bomSync.syncPlmBoms(records, { ownerId: 'u1', store, postJson, allowAi: false });
  assert.equal(second.changed, 0, 'aynı BOM + AI yine yok: yazılacak yeni bilgi yok');
  assert.equal(second.unchanged, 1);
  assert.equal(store.load()._revision, revision, 'revizyon artmaz; CP/Orders boşuna yeniden okumaz');
  assert.deepEqual(second.changedIds, []);

  // Kumaş değişirse kayıt yine güncellenir (AI ertelenmiş olsa da).
  const third = await bomSync.syncPlmBoms([{ ...records[0], fabric: '95% COTTON 5% EA' }], { ownerId: 'u1', store, postJson, allowAi: false });
  assert.equal(third.changed, 1);
  assert.deepEqual(third.changedIds, ['501']);
  assert.equal(store.entry('501').fabric, '95% COTTON 5% EA');
  assert.equal(store.entry('501').ai.status, 'deferred', 'ertelenmiş AI durumu korunur; elle senkron tamamlar');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('daha önce başlamış (iptal edilen sessiz) okumanın geç kaydı, daha taze elle okumayı ezmez', async () => {
  const { dir, store } = tmpStore();
  let releaseSilent;
  const silentGate = new Promise(resolve => { releaseSilent = resolve; });
  let cancelled = false;
  // Sessiz iş A'yı (601) PLM'in ESKİ hâliyle hemen okur; B (602) yanıtı beklerken iş sürer.
  const silentPost = async (_url, body) => {
    if (String(body.styleId) === '9602') await silentGate;
    return bomPayload(body.styleId, [printComponent()]);
  };
  const silentRun = bomSync.syncPlmBoms(
    [{ plmId: '601', styleId: '9601' }, { plmId: '602', styleId: '9602' }],
    { ownerId: 'u1', store, postJson: silentPost, allowAi: false, fetchConcurrency: 1, isCancelled: () => cancelled }
  );
  await new Promise(resolve => setTimeout(resolve, 10));

  // Kullanıcı elle senkron başlatır: A'nın YENİ hâlini (ön+arka) okur ve kaydeder; sessiz iş iptal istenir.
  const userPost = async (_url, body) => bomPayload(body.styleId, [
    printComponent(),
    printComponent({ styleBomComponentId: 12, componentId: 23, componentCode: 'B2', description: 'ARKA BEDEN / BACK BODY' }),
  ]);
  const user = await bomSync.syncPlmBoms([{ plmId: '601', styleId: '9601' }], { ownerId: 'u1', store, postJson: userPost, allowAi: false });
  assert.equal(user.changed, 1);
  assert.equal(store.entry('601').totalPrintCount, 2);
  cancelled = true;

  releaseSilent();
  const late = await silentRun;
  assert.equal(late.stopped, 'cancelled');
  assert.equal(store.entry('601').totalPrintCount, 2, 'eski okuma yeni kaydı ezmez');
  assert.equal(late.changedIds.includes('601'), false, 'ezilmeyen kayıt değişmiş sayılmaz');
  assert.equal(late.entries.get('601').totalPrintCount, 2, 'dönen kanıt depodaki güncel kayıttır');
  assert.ok(Number(store.entry('601').bomReadAt) > 0, 'kayıt okuma zamanını taşır');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('depo: okuma zamanı olmayan (eski sürüm) yazım engellenmez; eski okuma yenisini ezmez', () => {
  const { dir, store } = tmpStore();
  const entry = (count, bomReadAt) => ({
    plmId: '701', styleId: '9701', fingerprint: `f${count}`, bomReadAt,
    placements: Array.from({ length: count }, (_, i) => ({ componentCode: `B${i}`, placement: i ? 'back_body' : 'front_body', printType: 'Pigment', count: 1 })),
  });
  assert.equal(store.saveResults([entry(2, 2000)]).written, 1);
  const stale = store.saveResults([entry(1, 1000)]);
  assert.equal(stale.written, 0);
  assert.equal(stale.stale, 1);
  assert.equal(store.entry('701').totalPrintCount, 2);
  assert.equal(store.saveResults([entry(1, undefined)]).written, 1, 'okuma zamanı taşımayan çağrı eski davranışla yazar');
  fs.rmSync(dir, { recursive: true, force: true });
});

function fakeJobs() {
  const jobs = new Map();
  let seq = 0;
  const plmJobs = {
    create(_user, meta) { const id = `job${++seq}`; jobs.set(id, { id, ...meta, status: 'running', failures: [], cancel: false, reports: [] }); return jobs.get(id); },
    update(_user, id, patch) { jobs.get(id).reports.push(patch); Object.assign(jobs.get(id), patch); },
    addFailure(_user, id, failure) { jobs.get(id).failures.push(failure); },
    finish(_user, id, patch) { Object.assign(jobs.get(id), patch); },
    isCancelled(_user, id) { return jobs.get(id).cancel; },
    describe(_user, id) { return { ...jobs.get(id) }; },
    remove(_user, id) { jobs.delete(id); return true; },
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
      error.plmJobId = job.id;
      throw error;
    }
  }
  return { jobs, plmJobs, withPlmJob };
}

test('sessiz fetch isteğinin arka plan BOM işi oturum yenilemesini beklemez ve görünür faz yazmaz', async () => {
  const { createPlmFetchService } = require('../server/routes/plm-sync-routes');
  const { jobs, plmJobs, withPlmJob } = fakeJobs();
  const service = createPlmFetchService({
    normalizePlmId: value => String(value || '').trim(),
    setModelOperationProgress() {}, clearModelOperationProgress() {},
    getModelImageSettings: () => ({}), upsertPlmStyleLinks: () => null, userAccess: { appendAudit() {} },
    plmJobs, withPlmJob,
    plmPriority: { isBackgroundRequest: () => true },
    bomAuthWait: { waitMs: 5000, pollMs: 10 },
    agentBrowserConnector: { async collectCoreNectumStyleLinks(_o, items) { return { links: items.map(item => ({ plmId: item.plmId, styleId: '77' + item.plmId, productType: 'Single Style' })), failed: [], requested: items.length, diagnostics: [] }; } },
  });
  const started = Date.now();
  const result = await service.fetch({ id: 'u-silent' }, { plmIds: ['41'], bomMode: 'background' }, { request: { currentUser: { id: 'u-silent' }, headers: { 'x-buyerlog-auth-mode': 'silent' } }, allowAi: true });
  assert.ok(result.bomJob && result.bomJob.jobId);
  await new Promise(resolve => setTimeout(resolve, 200));
  const job = jobs.get(result.bomJob.jobId);
  assert.equal(job.status, 'failed', 'yetki yoksa sessiz iş doğrudan durur');
  assert.ok(Date.now() - started < 2000, 'oturum yenilemesi beklenmez');
  assert.equal(job.reports.some(patch => patch && patch.waitingAuth), false, 'görünür "oturum bekleniyor" fazı yazılmaz');
});

function silentHarness(overrides = {}) {
  const { dir, store } = tmpStore();
  const ledger = silent.createSilentScanLedger({ file: path.join(dir, 'silent.json'), now: overrides.now });
  const { jobs, plmJobs, withPlmJob } = fakeJobs();
  const calls = { collect: [], sync: [] };
  const service = silent.createSilentBomService({
    ledger,
    withPlmJob,
    plmJobs,
    tokenReady: overrides.tokenReady || (() => true),
    collectStyleLinks: overrides.collectStyleLinks || (async (_owner, items, options) => {
      calls.collect.push({ items, options });
      return { links: items.map(item => ({ plmId: item.plmId, styleId: '88' + item.plmId, productType: 'Single Style', fabric: 'COTTON' })), failed: [], requested: items.length };
    }),
    syncPlmBoms: overrides.syncPlmBoms || (async (records, options) => {
      calls.sync.push({ records, options });
      return bomSync.syncPlmBoms(records, { ...options, store, postJson: async (_u, body) => bomPayload(body.styleId, [printComponent()]) });
    }),
  });
  return { dir, store, ledger, jobs, calls, service };
}

test('sessiz servis: token yoksa CoreNectum çağrılmaz, iş açılmaz', async () => {
  const h = silentHarness({ tokenReady: () => false });
  const result = await h.service.run({ id: 'u1' }, ['11', '12'], { request: { currentUser: { id: 'u1' } } });
  assert.equal(result.status, 'no-token');
  assert.equal(h.calls.collect.length, 0);
  assert.equal(h.jobs.size, 0);
  assert.deepEqual(h.service.plan({ id: 'u1' }, ['11', '12']).due, ['11', '12'], 'atlanan modeller bugün yine vadeli');
  fs.rmSync(h.dir, { recursive: true, force: true });
});

test('sessiz servis: AI kapalı, düşük eşzamanlılık, sessiz iş; iş kaydı geride kalmaz; günde bir kez', async () => {
  let clock = new Date(2026, 10, 13, 10, 0, 0).getTime();
  const h = silentHarness({ now: () => clock });
  const user = { id: 'u1' };
  const request = { currentUser: user };
  assert.deepEqual(h.service.plan(user, ['11', '12', '13']).due, ['11', '12', '13']);

  const first = await h.service.run(user, ['11', '12'], { request });
  assert.equal(first.status, 'done');
  assert.deepEqual(first.changedIds.sort(), ['11', '12']);
  const options = h.calls.sync[0].options;
  assert.equal(options.allowAi, false, 'LCW AI kullanılmaz');
  assert.ok(options.fetchConcurrency <= 2, 'düşük eşzamanlılık');
  assert.equal(typeof options.waitForAuth, 'undefined', 'oturum beklenmez');
  assert.equal(typeof options.onProgress, 'undefined', 'ilerleme yazılmaz');
  assert.equal(h.jobs.size, 0, 'sessiz iş kaydı kullanıcı geçmişini doldurmaz');

  const plan = h.service.plan(user, ['11', '12', '13']);
  assert.deepEqual(plan.due, ['13']);
  assert.equal(plan.completedToday, false);
  const again = await h.service.run(user, ['11', '12'], { request });
  assert.equal(again.status, 'done');
  assert.equal(h.calls.collect.length, 1, 'bugün okunan model yeniden okunmaz');

  await h.service.run(user, ['13'], { request });
  assert.equal(h.service.plan(user, ['11', '12', '13']).completedToday, true);

  clock += 24 * 60 * 60 * 1000;
  assert.deepEqual(h.service.plan(user, ['11', '12', '13']).due, ['11', '12', '13'], 'ertesi gün yeniden vadeli');
  fs.rmSync(h.dir, { recursive: true, force: true });
});

test('sessiz servis: kullanıcı işi sürerken ertelenir; iptalde atlananlar işaretlenmez', async () => {
  const deferred = silentHarness();
  deferred.service = silent.createSilentBomService({
    ledger: deferred.ledger, plmJobs: { remove() {} }, tokenReady: () => true,
    withPlmJob: async () => { throw Object.assign(new Error('busy'), { statusCode: 409, code: 'PLM_BACKGROUND_DEFERRED' }); },
    collectStyleLinks: async () => { throw new Error('çağrılmamalı'); },
    syncPlmBoms: async () => { throw new Error('çağrılmamalı'); },
  });
  const result = await deferred.service.run({ id: 'u1' }, ['11'], { request: { currentUser: { id: 'u1' } } });
  assert.equal(result.status, 'deferred');
  assert.deepEqual(deferred.service.plan({ id: 'u1' }, ['11']).due, ['11']);
  fs.rmSync(deferred.dir, { recursive: true, force: true });

  const h = silentHarness({
    syncPlmBoms: async records => ({ stopped: 'cancelled', skippedIds: records.slice(1).map(r => r.plmId), changedIds: [records[0].plmId], failed: [], revision: 3 }),
  });
  const cancelled = await h.service.run({ id: 'u1' }, ['21', '22', '23'], { request: { currentUser: { id: 'u1' } } });
  assert.equal(cancelled.status, 'cancelled');
  assert.deepEqual(cancelled.changedIds, ['21']);
  assert.deepEqual(h.service.plan({ id: 'u1' }, ['21', '22', '23']).due, ['22', '23']);
  fs.rmSync(h.dir, { recursive: true, force: true });
});

test('sessiz servis: oturum düşerse durur, kalanlar işaretlenmez', async () => {
  const h = silentHarness({
    collectStyleLinks: async () => { throw Object.assign(new Error('401'), { code: 'CORENECTUM_API_TOKEN_INVALID' }); },
  });
  const result = await h.service.run({ id: 'u1' }, ['31'], { request: { currentUser: { id: 'u1' } } });
  assert.equal(result.status, 'auth');
  assert.deepEqual(h.service.plan({ id: 'u1' }, ['31']).due, ['31']);
  assert.equal(h.jobs.size, 0);
  fs.rmSync(h.dir, { recursive: true, force: true });
});

test('sessiz servis tek çağrıda sınırlı parti işler', async () => {
  const h = silentHarness();
  const ids = Array.from({ length: silent.SILENT_BATCH_MAX + 30 }, (_, i) => String(1000 + i));
  const result = await h.service.run({ id: 'u1' }, ids, { request: { currentUser: { id: 'u1' } } });
  assert.equal(result.processed, silent.SILENT_BATCH_MAX);
  assert.equal(h.service.plan({ id: 'u1' }, ids).due.length, 30);
  fs.rmSync(h.dir, { recursive: true, force: true });
});

test('sessiz uçlar sessiz başlık ister ve CP/Orders yetkisiyle korunur', () => {
  const routes = fs.readFileSync(path.join(__dirname, '..', 'server', 'routes', 'plm-sync-routes.js'), 'utf8');
  assert.match(routes, /app\.post\('\/api\/plm-sync\/bom\/silent\/plan', userAccess\.requireAnyArea\('cp', 'orders'\)/);
  assert.match(routes, /app\.post\('\/api\/plm-sync\/bom\/silent\/run', userAccess\.requireAnyArea\('cp', 'orders'\)/);
  assert.match(routes, /PLM_SILENT_HEADER_REQUIRED/);
});

test('job registry sessiz iş kaydını kaldırabilir; çalışan işi kaldırmaz', () => {
  const { createJobRegistry } = require('../server/lib/job-registry');
  const registry = createJobRegistry();
  const job = registry.create('u1', { kind: 'plm-bom', scope: 'cp', background: true });
  assert.equal(registry.remove('u1', job.id), false, 'çalışan iş kaldırılmaz');
  registry.finish('u1', job.id, { status: 'succeeded' });
  assert.equal(registry.remove('u1', job.id), true);
  assert.equal(registry.get('u1', job.id), null);
});

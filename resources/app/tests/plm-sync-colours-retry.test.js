'use strict';

/* PLM Sync — renk varyantları ve "hata işi durdurmaz" sözleşmesi.
 *   - Sync eşleşmesi renk satırı bazındadır; PLM'de olup Koleksiyon'da olmayan
 *     renkler yeni renk satırı ADAYIDIR (kullanıcı onayıyla eklenir).
 *   - Style List, BOM ve LCW AI hataları işi durdurmaz; yalnız başarısız
 *     kalemler kaldığı yerden en az 3 kez yeniden denenir.
 *   - Arka plan BOM işi oturum düşünce yeni yetkiyi bekleyip devam eder.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const groups = require('../public/collection-model-groups');
const bomSync = require('../server/lib/plm-bom-sync');
const { createStore } = require('../server/lib/plm-bom-store');
const { createJobRegistry } = require('../server/lib/job-registry');

const norm = value => String(value == null ? '' : value).trim();
const turknorm = value => norm(value).toLocaleUpperCase('tr-TR');
const helpers = {
  norm, turknorm,
  kolImportMatchKey: (plmId, modelKod) => norm(plmId) ? `plm:${norm(plmId)}` : norm(modelKod) ? `model:${turknorm(modelKod)}` : '',
  kolPlmNormalizeId: value => norm(value).replace(/^0+(?=\d)/, ''),
  kolPlmImportColourKey: row => groups.kolPlmImportColourKey(row, { norm, turknorm }),
  kolImportReadField: (row, key) => norm(row && row[key]),
  kolImportFieldLabel: key => key,
  knownByKey: {},
  touched: groups.kolPlmImportTouchedKeys(),
};
const plan = (kolRows, parsed) => groups.kolBuildPlmImportPlan(kolRows, parsed, helpers);
const parsed = (colourCode, extra = {}) => ({ plmId: '100', modelKod: 'MODEL-A', colourCode, colour: `C-${colourCode}`, season: '26 SS', ...extra });

test('her Koleksiyon renk satırı PLM’deki kendi rengiyle eşleşir; eksik renk yeni renk adayıdır', () => {
  const rows = [{ id: 1, plmId: '100', modelKod: 'MODEL-A', colourCode: 'A' }, { id: 2, plmId: '100', modelKod: 'MODEL-A', colourCode: 'B' }];
  const result = plan(rows, [parsed('A'), parsed('B'), parsed('C')]);
  assert.deepEqual(result.existing.map(item => [item.target.id, item.parsed.colourCode]), [[1, 'A'], [2, 'B']]);
  assert.deepEqual(result.creates.map(item => item.colourCode), ['C']);
  assert.equal(result.creates[0]._plmNewColour, true);
  assert.equal(result.ambiguous.length, 0, 'yeni renk artık belirsiz sayılıp atlanmaz');
});

test('rengi olmayan tek satır yalnız PLM’nin ilk rengine bağlanır; diğer renkler o satırı ezmez', () => {
  const rows = [{ id: 1, plmId: '100', modelKod: 'MODEL-A', colourCode: '' }];
  const result = plan(rows, [parsed('A'), parsed('B'), parsed('C')]);
  assert.deepEqual(result.existing.map(item => [item.target.id, item.parsed.colourCode]), [[1, 'A']]);
  assert.deepEqual(result.creates.map(item => [item.colourCode, item._plmNewColour]), [['B', true], ['C', true]]);
});

test('renkli tek satırda farklı PLM rengi yeni renk adayıdır; aynı renk satırı günceller', () => {
  const rows = [{ id: 1, plmId: '100', modelKod: 'MODEL-A', colourCode: 'B', season: 'eski' }];
  const result = plan(rows, [parsed('A'), parsed('B')]);
  assert.deepEqual(result.existing.map(item => [item.target.id, item.parsed.colourCode]), [[1, 'B']]);
  assert.ok(result.existing[0].changes.some(change => change.key === 'season'));
  assert.deepEqual(result.creates.map(item => item.colourCode), ['A']);
});

test('rengi belli olmayan satırların olduğu çok satırlı modelde tahmin yapılmaz', () => {
  const rows = [{ id: 1, plmId: '100', modelKod: 'MODEL-A', colourCode: 'A' }, { id: 2, plmId: '100', modelKod: 'MODEL-A', colourCode: '' }];
  const result = plan(rows, [parsed('C')]);
  assert.equal(result.creates.length, 0);
  assert.equal(result.ambiguous.length, 1);
});

test('Koleksiyon PLM Sync satır bazında eşler, PLM’de olmayan rengi hata saymaz ve yeni renkleri onayla ekler', () => {
  const app = read('public/app-main.js');
  const start = app.indexOf('function kolPlmSyncBuildSummary(');
  const block = app.slice(start, app.indexOf('function kolPlmSyncStampStatus(', start));
  assert.match(block, /byTarget\.set\(id,item\)/, 'eşleşme hedef satır kimliğiyle tutulur');
  assert.doesNotMatch(block, /byPlm\.set\(key,item\)/, 'PLM ID başına tek eşleşme tutulmaz');
  assert.match(block, /kolPlmSyncModelLevelItem\(row,candidates\[0\],plan\.knownByKey\)/);
  assert.match(block, /parsed\._plmNewColour&&targetPlm\.has/);
  assert.match(app, /api\.mergeGroups\(kolRows,\[anchor\.id,\.\.\.ids\],anchor\.id\)/, 'yeni renk mevcut model grubuna bağlanır');
  // Excel, seçili ve liste içe aktarmaları da yeni renk satırını mevcut modele bağlar;
  // satır referansları kullanıldıktan sonra, kayıttan hemen önce.
  assert.equal((app.match(/kolPlmJoinColourRowsToModels\(kolPlmNewColourRowIds\(created\)\);\s*saveKolRows\(\);/g) || []).length, 3);
  assert.match(app, /data-plmsync-newcolours checked/);
  assert.match(app, /const addedColours=approved\.addColours\?kolPlmSyncAddNewColours\(summary\.newColours\):\[\];/);
  assert.match(app, /if\(!summary\.changed\.length&&!\(summary\.newColours\|\|\[\]\)\.length\)\{/);
  assert.match(app, /'PLM’de olup Koleksiyon’da olmayan renkler'/);
  assert.match(app, /'Colours in PLM that are missing in Collection'/);
});

test('yeni renk satırı model düzeyindeki Buyer Log değerlerini mevcut modelden devralır; kalıcı boş fark oluşmaz', () => {
  const rows = groups.normalizeRows([
    { id: 1, plmId: '100', modelKod: 'MODEL-A', colourCode: 'A', colour: 'BLACK', pricing: { Factory: 5 }, confirmedManufacturer: 'Factory', mbMonth: '2027-03', not: 'model notu' },
    { id: 2, plmId: '100', modelKod: 'MODEL-A', colourCode: 'B', colour: 'NAVY', pricing: { Factory: 5 }, confirmedManufacturer: 'Factory', mbMonth: '2027-03', not: 'model notu' },
  ]).rows;
  const grouped = groups.mergeGroups(rows, [1, 2], 1);
  assert.equal(grouped.changed, true, 'mevcut model iki renkli tek grup');
  const baseline = { pricing: {}, confirmedManufacturer: '', delType: 'Gemi' };
  const fresh = { id: 3, plmId: '100', modelKod: 'MODEL-A', colourCode: 'C', colour: 'BLUE', pricing: {}, confirmedManufacturer: '', mbMonth: '', delType: 'Gemi', not: 'bu içe aktarmada verilen not' };
  let all = groups.normalizeRows([...grouped.rows, fresh]).rows;
  const anchor = all.find(row => row.id === 1);
  const added = all.find(row => row.id === 3);
  groups.inheritModelValues(added, anchor, all, { baseline, keep: ['colourCode', 'colour'] });
  const merged = groups.mergeGroups(all, [1, 3], 1);
  assert.equal(merged.changed, true);
  all = merged.rows;
  const row = all.find(item => item.id === 3);
  assert.deepEqual(groups.effectiveValue(row, 'pricing', all), { Factory: 5 });
  assert.equal(groups.effectiveValue(row, 'confirmedManufacturer', all), 'Factory');
  assert.equal(groups.effectiveValue(row, 'mbMonth', all), '2027-03');
  assert.equal(row.colourCode, 'C', 'renk alanı devralınmaz');
  assert.equal((row.variantOverrides || {}).pricing, undefined, 'boş fiyatlama kalıcı fark olarak donmaz');
  assert.equal(groups.effectiveValue(row, 'not', all), 'bu içe aktarmada verilen not', 'açıkça verilen değer korunur');
  assert.equal(new Set(all.filter(item => item.plmId === '100').map(item => item.modelGroupId)).size, 1);
});

const tmpStore = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'buyerlog-bom-retry-'));
  return { dir, store: createStore(path.join(dir, 'plm-bom.json')) };
};
const bomPayload = styleId => ({ data: { coreNectumResultData: { styleBom: { styleId: Number(styleId), styleBomId: 1, styleBomComponents: [] } }, success: true } });
const targets = count => Array.from({ length: count }, (_, i) => ({ plmId: String(700 + i), styleId: String(9700 + i) }));

test('BOM hatası işi durdurmaz: yalnız başarısız model kaldığı yerden yeniden denenir', async () => {
  const { dir, store } = tmpStore();
  const calls = new Map();
  const postJson = async (_url, body) => {
    const id = String(body.styleId);
    calls.set(id, (calls.get(id) || 0) + 1);
    if (id === '9701' && calls.get(id) <= 2) throw Object.assign(new Error('HTTP 503'), { code: 'CORENECTUM_API_HTTP_ERROR' });
    return bomPayload(id);
  };
  const result = await bomSync.syncPlmBoms(targets(4), { ownerId: 'u1', store, postJson, retryDelaysMs: [0] });
  assert.equal(result.failed.length, 0);
  assert.equal(result.fetched, 4);
  assert.equal(calls.get('9701'), 3, 'iki hatadan sonra üçüncü denemede okundu');
  assert.deepEqual([...calls].filter(([id]) => id !== '9701').map(([, n]) => n), [1, 1, 1], 'başarılı modeller yeniden sorulmaz');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('kalıcı BOM hatası ilk denemeye ek en az 3 tur yeniden denendikten sonra raporlanır', async () => {
  const { dir, store } = tmpStore();
  let calls = 0;
  const postJson = async () => { calls += 1; throw Object.assign(new Error('down'), { code: 'CORENECTUM_API_TIMEOUT' }); };
  const result = await bomSync.syncPlmBoms(targets(1), { ownerId: 'u1', store, postJson, retryDelaysMs: [0] });
  assert.equal(calls, 1 + bomSync.RETRY_ROUNDS);
  assert.ok(bomSync.RETRY_ROUNDS >= 3);
  assert.equal(result.failed.length, 1);
  assert.equal(result.failed[0].code, 'CORENECTUM_API_TIMEOUT');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('oturum düşünce iş durmaz: yeni yetki beklenir ve kalan modeller kaldığı yerden okunur', async () => {
  const { dir, store } = tmpStore();
  let renewed = false, waits = 0;
  const seen = [];
  const postJson = async (_url, body) => {
    seen.push(String(body.styleId));
    if (!renewed && seen.length >= 2) throw Object.assign(new Error('401'), { code: 'CORENECTUM_API_TOKEN_INVALID' });
    return bomPayload(body.styleId);
  };
  const result = await bomSync.syncPlmBoms(targets(4), {
    ownerId: 'u1', store, postJson, fetchConcurrency: 1, retryDelaysMs: [0],
    waitForAuth: async () => { waits += 1; renewed = true; return true; },
  });
  assert.equal(waits, 1);
  assert.equal(result.stopped, null);
  assert.equal(result.failed.length, 0);
  assert.equal(result.fetched, 4);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('yenileme tamamlandıktan sonra geç dönen eski-token 401 ikinci bir bekleme açmaz', async () => {
  const { dir, store } = tmpStore();
  let generation = 1, waits = 0;
  const postJson = async (_url, body) => {
    const sentWith = generation;
    // İki istek eski yetkiyle uçuşta; biri hemen, diğeri yenilemeden SONRA 401 döner.
    if (sentWith === 1 && String(body.styleId) === '9700') throw Object.assign(new Error('401'), { code: 'CORENECTUM_API_TOKEN_INVALID', details: { tokenGeneration: sentWith } });
    if (sentWith === 1 && String(body.styleId) === '9701') {
      await new Promise(resolve => setTimeout(resolve, 40));
      throw Object.assign(new Error('401'), { code: 'CORENECTUM_API_TOKEN_INVALID', details: { tokenGeneration: sentWith } });
    }
    return bomPayload(body.styleId);
  };
  const result = await bomSync.syncPlmBoms(targets(4), {
    ownerId: 'u1', store, postJson, fetchConcurrency: 2, retryDelaysMs: [0],
    currentTokenGeneration: () => generation,
    waitForAuth: async () => { waits += 1; generation += 1; return true; },
  });
  assert.equal(waits, 1, 'tamamlanmış yenileme yeniden beklenmez');
  assert.equal(result.stopped, null);
  assert.equal(result.failed.length, 0);
  assert.equal(result.fetched, 4);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('istemci 401 hatası yalnız token kuşağını taşır, token değerini taşımaz', () => {
  const client = read('server/lib/corenectum-api-client.js');
  assert.match(client, /const generation = settings\.currentTokenGeneration\(\);/);
  assert.match(client, /\{remoteStatus:response\.status,tokenGeneration:generation\}/);
  const route = read('server/routes/plm-sync-routes.js');
  assert.match(route, /if \(coreNectumApiSettings\.currentTokenGeneration\(\) > baseline && coreNectumApiSettings\.getToken\(profile\.id\)\) return Promise\.resolve\(true\);/);
});

test('yenilenmeyen oturumda iş en fazla 3 bekleme sonrası durur, okunanlar kaydedilir', async () => {
  const { dir, store } = tmpStore();
  let waits = 0, calls = 0;
  const postJson = async (_url, body) => { calls += 1; if (calls > 1) throw Object.assign(new Error('401'), { code: 'CORENECTUM_API_TOKEN_INVALID' }); return bomPayload(body.styleId); };
  const result = await bomSync.syncPlmBoms(targets(3), {
    ownerId: 'u1', store, postJson, fetchConcurrency: 1, retryDelaysMs: [0],
    waitForAuth: async () => { waits += 1; return waits < 3; },
  });
  assert.equal(result.stopped, 'auth');
  assert.ok(waits <= 3);
  assert.ok(store.entry('700'), 'yetki bitmeden okunan BOM kaydedildi');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('LCW AI geçici hatası en az 3 kez denenir; oturum hatası tekrarlanmaz', async () => {
  const ambiguous = { styleBomComponentId: 1, componentId: 1, componentCode: 'B-UNKNOWN', description: 'SPECIAL ART POSITION', mainCategoryId: 1, mainCategoryName: 'Embellishment', categoryId: 21, categoryName: 'Print', categoryGroupName: 'Pigment', quantity: 1 };
  const postJson = async (_url, body) => ({ data: { coreNectumResultData: { styleBom: { styleId: Number(body.styleId), styleBomId: 1, styleBomComponents: [ambiguous] } }, success: true } });
  const answer = { text: JSON.stringify({ placements: [{ componentCode: 'B-UNKNOWN', placement: 'chest', confidence: 'high' }], confidence: 'high', notes: [] }), model: { key: 'm' } };

  let asks = 0;
  const flaky = { async ask() { asks += 1; if (asks < 3) throw Object.assign(new Error('timeout'), { code: 'LCWAI_TIMEOUT', retryable: true }); return answer; } };
  let store = tmpStore();
  let result = await bomSync.syncPlmBoms(targets(1), { ownerId: 'u1', store: store.store, postJson, aiEngine: flaky, aiRetryDelayMs: 0, retryDelaysMs: [0] });
  assert.equal(asks, 3); assert.equal(result.aiResolved, 1);
  fs.rmSync(store.dir, { recursive: true, force: true });

  asks = 0;
  const expired = { async ask() { asks += 1; throw Object.assign(new Error('expired'), { code: 'LCWAI_SESSION_EXPIRED', retryable: false }); } };
  store = tmpStore();
  result = await bomSync.syncPlmBoms(targets(1), { ownerId: 'u1', store: store.store, postJson, aiEngine: expired, aiRetryDelayMs: 0, retryDelaysMs: [0] });
  assert.equal(asks, 1, 'reddedilen oturum yeniden zorlanmaz');
  assert.equal(store.store.entry('700').ai.status, 'failed');
  fs.rmSync(store.dir, { recursive: true, force: true });
});

test('Style List partisi tüm bölmelerden sonra da başarısızsa iş durmaz; yalnız o PLM’ler yeniden sorulur', async t => {
  const client = require('../server/lib/corenectum-api-client');
  const connector = require('../server/lib/agent-browser-connector');
  const original = client.postJson;
  t.after(() => { client.postJson = original; });
  const respond = codes => ({ data: { coreNectumResultData: { styleListResult: codes.map(code => ({ plmCode: Number(code), styleId: Number(code) + 500000, styleName: `S${code}`, colors: [{ name: 'BLACK', colorCode: 'Q6K' }, { name: 'NAVY', colorCode: 'Q2K' }] })) } } });
  const items = Array.from({ length: 150 }, (_, i) => ({ plmId: String(3000 + i), needImage: false }));
  const badCode = '3120';
  let badCalls = 0;
  client.postJson = async (_owner, _url, body) => {
    const codes = String(body.filterCriterias[0].filterValue).split(',');
    if (codes.includes(badCode)) { badCalls += 1; if (badCalls <= 4) throw Object.assign(new Error('HTTP 502'), { code: 'CORENECTUM_API_HTTP_ERROR' }); }
    return respond(codes);
  };
  const result = await connector.collectCoreNectumStyleLinks('u1', items, { retryDelaysMs: [0] });
  assert.equal(result.links.length, 150, 'yeniden deneme turunda kalan PLM’ler de okundu');
  assert.equal(result.failed.length, 0);
  assert.ok(result.links.every(link => link.colors.length === 2), 'tüm renkler korunur');

  client.postJson = async (_owner, _url, body) => {
    const codes = String(body.filterCriterias[0].filterValue).split(',');
    if (codes.includes(badCode)) throw Object.assign(new Error('HTTP 502'), { code: 'CORENECTUM_API_HTTP_ERROR' });
    return respond(codes);
  };
  const partial = await connector.collectCoreNectumStyleLinks('u1', items, { retryDelaysMs: [0] });
  assert.equal(partial.links.length, 149, 'kalıcı hata yalnız o PLM’yi etkiler');
  assert.deepEqual(partial.failed.map(item => [item.plmId, item.code]), [[badCode, 'CORENECTUM_STYLE_LOOKUP_FAILED']]);

  client.postJson = async () => { throw Object.assign(new Error('HTTP 503'), { code: 'CORENECTUM_API_HTTP_ERROR' }); };
  await assert.rejects(connector.collectCoreNectumStyleLinks('u1', items, { retryDelaysMs: [0] }), { code: 'CORENECTUM_API_HTTP_ERROR' }, 'tam kesinti “bulunamadı” diye gizlenmez');
});

test('arka plan işi yeni token gelene kadar bekler ve bunu iş kaydında gösterir', async () => {
  const settings = require('../server/lib/corenectum-api-settings');
  const { waitForFreshToken } = require('../server/routes/plm-sync-routes');
  const jobs = createJobRegistry();
  const created = jobs.create('u-wait', { kind: 'plm-bom', scope: 'koleksiyon', total: 1 });
  const job = { report: patch => jobs.update('u-wait', created.id, patch), cancelled: () => false };
  settings.saveToken('u-wait', 'a'.repeat(40));
  const waiting = waitForFreshToken({ id: 'u-wait' }, job, { waitMs: 2000, pollMs: 10 });
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.equal(jobs.describe('u-wait', created.id).waitingAuth, true);
  settings.saveToken('u-wait', 'b'.repeat(40));
  assert.equal(await waiting, true);
  assert.equal(jobs.describe('u-wait', created.id).waitingAuth, false);
  settings.clearToken('u-wait');
  assert.equal(await waitForFreshToken({ id: 'u-wait' }, job, { waitMs: 40, pollMs: 10 }), false, 'süre dolarsa iş durur');
});

test('istemci ilk fazı geçici hatada 3 kez yeniden dener ve bekleyen işte oturum kurtarmasını başlatır', () => {
  const app = read('public/app-main.js');
  assert.match(app, /const KOL_PLM_FETCH_RETRIES=3,/);
  assert.match(app, /async function kolPlmFetchWithRetry\(body,span\)/);
  assert.match(app, /return !coreNectumAuthenticationError\(error\);/, 'giriş penceresi tekrar tekrar açılmaz');
  assert.match(app, /if\(job&&job\.waitingAuth&&!authPrompted\)\{/);
  assert.match(app, /'PLM BOM sırasında CoreNectum oturumu sona erdi\. Oturumu yenileyin; iş kaldığı yerden sürecek\.'/);
});

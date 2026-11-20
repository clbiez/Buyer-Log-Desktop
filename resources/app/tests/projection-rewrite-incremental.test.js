'use strict';
// #1078 takip / WS7b: CP satır kaydından sonra projeksiyon yeniden yazımı işçide, yalnız değişen
// modül yazılır, ardışık yeniden yazımlar birleştirilir. Sözleşme: son nesil, eski tam yeniden
// yazımla (rewriteGeneration + server.js transform'u, tam override nesnesi) birebir aynıdır.
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), zlib = require('node:zlib'), crypto = require('node:crypto');

const cacheRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bl-projection-rewrite-'));
process.env.BUYER_LOG_LOCAL_DATA_ROOT = cacheRoot;
const pageCache = require('../server/lib/page-projection-cache');
const { applyIncrementalProjectionPatch, projectionPatchMatches } = require('../server/lib/projection-row-patch');
const { rowPatchContext } = require('../server/lib/projection-rewrite');
const { serialize } = require('../server/lib/compute-tasks');
const { closeProjectionRewritePool } = require('../server/lib/projection-rewrite-pool');
const { buildFixture, buildSteps } = require('./fixtures/projection-rewrite-fixture');
test.after(async () => { await closeProjectionRewritePool(); fs.rmSync(cacheRoot, { recursive: true, force: true }); });

// server.js rewriteProjectionCacheForRowPatches transform'u (eski yol, #1096 sonrası hâli) — birebir.
function legacyTransform(clean, overrides, cpRows) {
  return (_module, payload) => {
    if (!payload || typeof payload !== 'object') return payload;
    const lists = [];
    if (Array.isArray(payload.rows)) lists.push(payload.rows);
    if (Array.isArray(payload.orderSummary)) lists.push(payload.orderSummary);
    for (const rows of lists) for (const row of rows) for (const item of clean) {
      if (projectionPatchMatches(row, item)) {
        applyIncrementalProjectionPatch(row, item.patch, overrides, _module !== 'orders');
        if (cpRows && _module === 'cp' && rows === payload.rows && !cpRows.includes(row)) cpRows.push(row);
      }
    }
    if (cpRows && _module === 'cp') cpRows.json = serialize(cpRows, 'projection');
    return payload;
  };
}
async function seed(userId, fixture) {
  return pageCache.writeGeneration(userId, { contextHash: 'ctx-0', sourceLoadedAt: '2026-11-20T00:00:00.000Z', projections: fixture.projections,
    extra: { runtimeMeta: { loadedAt: 'x' }, sourceRevisionKey: 'rev-1' } });
}
function moduleHashes(userId) {
  const manifest = pageCache.loadManifest(userId), out = {};
  for (const module of Object.keys(manifest.modules)) {
    const file = path.join(pageCache.ROOT, pageCache.safeUserId(userId), manifest.activeGeneration, module + '.json.gz');
    out[module] = crypto.createHash('sha256').update(zlib.gunzipSync(fs.readFileSync(file))).digest('hex');
  }
  return { contextHash: manifest.contextHash, modules: out, sourceLoadedAt: manifest.sourceLoadedAt, runtimeMeta: manifest.runtimeMeta, sourceRevisionKey: manifest.sourceRevisionKey };
}
async function runLegacy(userId, fixture, steps) {
  await seed(userId, fixture);
  const cpJson = [];
  for (const [index, step] of steps.entries()) {
    const cpRows = [];
    const manifest = await pageCache.rewriteGeneration(userId, { fromContextHash: `ctx-${index}`, toContextHash: `ctx-${index + 1}`, transform: legacyTransform(step.items, step.overrides, cpRows) });
    assert.ok(manifest, 'legacy rewrite ' + index);
    cpJson.push(cpRows.json);
  }
  return { hashes: moduleHashes(userId), cpJson };
}
// Yeni yol: bütün kayıtlar beklemeden kuyruğa girer (kayıt akışı); birleşebilir.
async function runIncremental(userId, fixture, steps) {
  await seed(userId, fixture);
  const results = await Promise.all(steps.map((step, index) => pageCache.rewriteRowPatches(userId, {
    fromContextHash: `ctx-${index}`, toContextHash: `ctx-${index + 1}`, items: step.items, context: rowPatchContext(step.overrides, step.items), collectCpRows: true })));
  results.forEach((result, index) => assert.ok(result && result.manifest, 'incremental rewrite ' + index));
  return { hashes: moduleHashes(userId), cpJson: results.map(result => serialize(result.cpRows, 'projection')), results };
}

for (const scenario of [
  { name: 'tek kayıt', count: 1 },
  { name: 'ardışık 16 kayıt', count: 16 },
  { name: 'iki sekme eşzamanlı (aynı satırlara sırayla iki sekmeden)', count: 16, twoTabs: true },
]) {
  for (const via of ['worker', 'main']) {
    test(`parite (${via}): ${scenario.name} — son nesil ve her kaydın CP satırları eski tam yeniden yazımla aynı`, async () => {
      if (via === 'main') process.env.BL_PROJECTION_REWRITE_WORKER = '0'; else delete process.env.BL_PROJECTION_REWRITE_WORKER;
      try {
        const fixture = buildFixture({ rows: 400, seed: 11 }), steps = buildSteps(fixture, { count: scenario.count, twoTabs: scenario.twoTabs });
        const tag = `${via}-${scenario.count}-${scenario.twoTabs ? 2 : 1}`;
        const legacy = await runLegacy('legacy-' + tag, fixture, steps);
        const incremental = await runIncremental('new-' + tag, fixture, steps);
        assert.deepEqual(incremental.hashes, legacy.hashes);
        assert.deepEqual(incremental.cpJson, legacy.cpJson);
        assert.ok(incremental.results.every(result => result.info.via === via));
        if (scenario.count > 1) assert.ok(incremental.results.some(result => result.info.batchSize > 1), 'kuyruktaki ardışık yeniden yazımlar birleşir');
        // Hiç satırı değişmeyen modül (collection-catalog) yeniden serileştirilmez.
        assert.ok(incremental.results.every(result => !result.info.changedModules.includes('collection-catalog')));
      } finally { delete process.env.BL_PROJECTION_REWRITE_WORKER; }
    });
  }
}

test('değişmeyen modülün sıkıştırılmış baytları yeni nesle aynen taşınır', async () => {
  const fixture = buildFixture({ rows: 50, seed: 3 }), steps = buildSteps(fixture, { count: 1 });
  const before = await seed('bytes-user', fixture);
  const file = (manifest, module) => path.join(pageCache.ROOT, 'bytes-user', manifest.activeGeneration, module + '.json.gz');
  const original = fs.readFileSync(file(before, 'collection-catalog'));
  const { manifest } = await pageCache.rewriteRowPatches('bytes-user', { fromContextHash: 'ctx-0', toContextHash: 'ctx-1', items: steps[0].items, context: rowPatchContext(steps[0].overrides, steps[0].items) });
  assert.notEqual(manifest.activeGeneration, before.activeGeneration);
  assert.deepEqual(fs.readFileSync(file(manifest, 'collection-catalog')), original);
  assert.deepEqual(manifest.modules['collection-catalog'], before.modules['collection-catalog']);
  assert.notEqual(manifest.modules.cp.checksum, before.modules.cp.checksum);
});

test('araya giren başka mutasyon zinciri keser: birleştirme yapılmaz, sonuç eski yolla aynı', async () => {
  const fixture = buildFixture({ rows: 80, seed: 5 }), steps = buildSteps(fixture, { count: 2 });
  const extraCatalog = { values: ['between'] };
  // Eski yol: kayıt 1 → aynı bağlamda modül yazımı → kayıt 2.
  await seed('chain-legacy', fixture);
  await pageCache.rewriteGeneration('chain-legacy', { fromContextHash: 'ctx-0', toContextHash: 'ctx-1', transform: legacyTransform(steps[0].items, steps[0].overrides, null) });
  await pageCache.writeProjection('chain-legacy', 'collection-catalog', 'ctx-1', extraCatalog);
  await pageCache.rewriteGeneration('chain-legacy', { fromContextHash: 'ctx-1', toContextHash: 'ctx-2', transform: legacyTransform(steps[1].items, steps[1].overrides, null) });
  // Yeni yol: üçü de beklemeden kuyruğa girer.
  await seed('chain-new', fixture);
  const [first, written, second] = await Promise.all([
    pageCache.rewriteRowPatches('chain-new', { fromContextHash: 'ctx-0', toContextHash: 'ctx-1', items: steps[0].items, context: rowPatchContext(steps[0].overrides, steps[0].items) }),
    pageCache.writeProjection('chain-new', 'collection-catalog', 'ctx-1', extraCatalog),
    pageCache.rewriteRowPatches('chain-new', { fromContextHash: 'ctx-1', toContextHash: 'ctx-2', items: steps[1].items, context: rowPatchContext(steps[1].overrides, steps[1].items) }),
  ]);
  assert.ok(written, 'modül yazımı kendi bağlamında uygulanır (birleştirme onu atlatmaz)');
  assert.equal(first.info.batchSize, 1); assert.equal(second.info.batchSize, 1);
  assert.deepEqual(moduleHashes('chain-new'), moduleHashes('chain-legacy'));
});

test('bağlamı eşleşmeyen istek eski yol gibi null döner ve nesli değiştirmez', async () => {
  const fixture = buildFixture({ rows: 20, seed: 9 }), steps = buildSteps(fixture, { count: 1 });
  const before = await seed('stale-user', fixture);
  const result = await pageCache.rewriteRowPatches('stale-user', { fromContextHash: 'ctx-other', toContextHash: 'ctx-1', items: steps[0].items, context: {} });
  assert.equal(result, null);
  assert.equal(pageCache.loadManifest('stale-user').activeGeneration, before.activeGeneration);
});

test('işçi hatası: aynı istek ana iş parçacığında aynı sonuçla tamamlanır', async () => {
  const fixture = buildFixture({ rows: 120, seed: 13 }), steps = buildSteps(fixture, { count: 3 });
  const legacy = await runLegacy('fallback-legacy', fixture, steps);
  pageCache.setRowRewriteRunnerForTests(() => Promise.reject(Object.assign(new Error('boom'), { code: 'PROJECTION_REWRITE_WORKER_FAILED' })));
  const warn = console.warn; console.warn = () => {};
  try {
    const incremental = await runIncremental('fallback-new', fixture, steps);
    assert.deepEqual(incremental.hashes, legacy.hashes);
    assert.ok(incremental.results.every(result => result.info.via === 'main'));
  } finally { pageCache.setRowRewriteRunnerForTests(null); console.warn = warn; }
});

test('yazım yarıda kalırsa (atomik yazım hatası) aktif nesil değişmez, okunabilir kalır ve hata çağırana döner', async () => {
  const fixture = buildFixture({ rows: 40, seed: 17 }), steps = buildSteps(fixture, { count: 2 });
  const before = await seed('crash-user', fixture);
  const rename = fs.promises.rename;
  let calls = 0;
  fs.promises.rename = async (from, to) => { calls += 1; if (calls === 2) throw Object.assign(new Error('disk full'), { code: 'ENOSPC' }); return rename(from, to); };
  const copyFile = fs.promises.copyFile;
  fs.promises.copyFile = async () => { throw Object.assign(new Error('disk full'), { code: 'ENOSPC' }); };
  try {
    const outcome = await Promise.allSettled(steps.map((step, index) => pageCache.rewriteRowPatches('crash-user', {
      fromContextHash: `ctx-${index}`, toContextHash: `ctx-${index + 1}`, items: step.items, context: rowPatchContext(step.overrides, step.items) })));
    assert.ok(outcome.every(item => item.status === 'rejected'), 'birleşen bütün istekler hatayı alır');
  } finally { fs.promises.rename = rename; fs.promises.copyFile = copyFile; }
  const manifest = pageCache.loadManifest('crash-user');
  assert.equal(manifest.activeGeneration, before.activeGeneration);
  const read = await pageCache.readProjection('crash-user', 'cp', 'ctx-0');
  assert.equal(read.data.rows.length, fixture.projections.cp.rows.length);
  const dirs = fs.readdirSync(path.join(pageCache.ROOT, 'crash-user')).filter(name => !name.startsWith('manifest'));
  assert.deepEqual(dirs, [before.activeGeneration], 'yarım nesil dizini kalmaz');
});

test('projeksiyon okuması bekleyen birleşik yeniden yazımın bitmesini bekler ve yeni bağlamı okur', async () => {
  const fixture = buildFixture({ rows: 60, seed: 19 }), steps = buildSteps(fixture, { count: 4 });
  await seed('reader-user', fixture);
  const rewrites = steps.map((step, index) => pageCache.rewriteRowPatches('reader-user', {
    fromContextHash: `ctx-${index}`, toContextHash: `ctx-${index + 1}`, items: step.items, context: rowPatchContext(step.overrides, step.items) }));
  const read = await pageCache.readProjectionCompressed('reader-user', 'orders', 'ctx-4');
  assert.ok(read && read.hit, 'son bağlam okumadan önce yazılmış olur');
  await Promise.all(rewrites);
});

test('rowPatchContext yalnız yamalanan siparişlerin anahtarlarını taşır (satır ve sipariş düzeyi)', () => {
  const overrides = { notesmap: { '100|M1|C1': { NotesHtml: 'a' }, '100': { NotesHtml: 'b' }, '200|M2|C2': { NotesHtml: 'c' } },
    importancemap: { '100|M1|C1': 'bts', '300': 'x' }, importanceSettings: { rules: [] }, noteColumnDefs: [{ id: 'nc1' }], transitRules: [{ id: 't' }], other: { big: true } };
  const context = rowPatchContext(overrides, [{ orderCode: 100, patch: {} }]);
  assert.deepEqual(Object.keys(context.notesmap).sort(), ['100', '100|M1|C1']);
  assert.deepEqual(Object.keys(context.importancemap), ['100|M1|C1']);
  assert.equal(context.noteColumnDefs, overrides.noteColumnDefs);
  assert.equal(context.transitRules, overrides.transitRules);
  assert.equal(context.importanceSettings, overrides.importanceSettings);
  assert.equal(context.other, undefined);
});

'use strict';
// ADR-0003 §6B Pilot B: projeksiyon yama günlüğü (BL_PROJECTION_PATCH_LOG=1, varsayılan kapalı).
// Sözleşme: bayrak açıkken her düzenlemeden sonra okunan projeksiyon ve CP satırları, eski tam
// yeniden yazımla (rewriteGeneration + server.js transform'u) birebir aynıdır; günlük sınırlıdır;
// yırtık/uyuşmayan günlük önbelleği atar; bekleyen günlüklü .bak sunulmaz; araya giren mutasyon önce sıkıştırır.
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), zlib = require('node:zlib'), crypto = require('node:crypto');

const cacheRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bl-projection-patch-log-'));
process.env.BUYER_LOG_LOCAL_DATA_ROOT = cacheRoot;
const pageCache = require('../server/lib/page-projection-cache');
const { applyIncrementalProjectionPatch, projectionPatchMatches } = require('../server/lib/projection-row-patch');
const { rowPatchContext } = require('../server/lib/projection-rewrite');
const { serialize } = require('../server/lib/compute-tasks');
const { closeProjectionRewritePool } = require('../server/lib/projection-rewrite-pool');
const { buildFixture, buildSteps } = require('./fixtures/projection-rewrite-fixture');

const ENV_KEYS = ['BL_PROJECTION_PATCH_LOG', 'BL_PROJECTION_PATCH_LOG_MAX_ENTRIES', 'BL_PROJECTION_PATCH_LOG_MAX_BYTES', 'BL_PROJECTION_PATCH_LOG_IDLE_MS', 'BL_PROJECTION_REWRITE_WORKER'];
function withEnv(values, fn) {
  return async () => {
    const saved = Object.fromEntries(ENV_KEYS.map(key => [key, process.env[key]]));
    for (const [key, value] of Object.entries(values)) if (value == null) delete process.env[key]; else process.env[key] = String(value);
    try { await fn(); } finally { for (const key of ENV_KEYS) if (saved[key] == null) delete process.env[key]; else process.env[key] = saved[key]; }
  };
}
test.after(async () => { await closeProjectionRewritePool(); fs.rmSync(cacheRoot, { recursive: true, force: true }); });

// projection-rewrite-incremental.test.js ile aynı eski yol (server.js transform'u).
function legacyTransform(clean, overrides, cpRows) {
  const legacyContext = { ...overrides, cpRowStored: overrides };
  return (_module, payload) => {
    if (!payload || typeof payload !== 'object') return payload;
    const lists = [];
    if (Array.isArray(payload.rows)) lists.push(payload.rows);
    if (Array.isArray(payload.orderSummary)) lists.push(payload.orderSummary);
    for (const rows of lists) for (const row of rows) for (const item of clean) {
      if (projectionPatchMatches(row, item)) {
        applyIncrementalProjectionPatch(row, item.patch, legacyContext, _module !== 'orders', { cpStored: _module === 'cp' && rows === payload.rows });
        if (cpRows && _module === 'cp' && rows === payload.rows && !cpRows.includes(row)) cpRows.push(row);
      }
    }
    if (cpRows && _module === 'cp') cpRows.json = serialize(cpRows, 'projection');
    return payload;
  };
}
const seed = (userId, fixture) => pageCache.writeGeneration(userId, { contextHash: 'ctx-0', sourceLoadedAt: '2026-11-20T00:00:00.000Z', projections: fixture.projections,
  extra: { runtimeMeta: { loadedAt: 'x' }, sourceRevisionKey: 'rev-1' } });
function moduleHashes(userId) {
  const manifest = pageCache.loadManifest(userId), out = {};
  for (const module of Object.keys(manifest.modules)) {
    const file = path.join(pageCache.ROOT, pageCache.safeUserId(userId), manifest.activeGeneration, module + '.json.gz');
    out[module] = crypto.createHash('sha256').update(zlib.gunzipSync(fs.readFileSync(file))).digest('hex');
  }
  return { contextHash: manifest.contextHash, modules: out, sourceLoadedAt: manifest.sourceLoadedAt, runtimeMeta: manifest.runtimeMeta, sourceRevisionKey: manifest.sourceRevisionKey, backlogVariants: manifest.backlogVariants };
}
// Okuyucunun gördüğü (sıkıştırma sonrası) modül içerikleri.
async function readHashes(userId, contextHash) {
  const manifest = pageCache.loadManifest(userId), out = {};
  for (const module of Object.keys(manifest.modules)) {
    const read = await pageCache.readProjectionCompressed(userId, module, contextHash);
    assert.ok(read, `okuma ${module} @${contextHash}`);
    out[module] = crypto.createHash('sha256').update(zlib.gunzipSync(read.buffer)).digest('hex');
  }
  return out;
}
const patchArgs = (step, index) => ({ fromContextHash: `ctx-${index}`, toContextHash: `ctx-${index + 1}`, items: step.items, context: rowPatchContext(step.overrides, step.items), collectCpRows: true });
async function deferredJson(result) { const rows = result.deferredCpRows ? await result.deferredCpRows : result.cpRows; return rows ? serialize(rows, 'projection') : null; }

for (const via of ['worker', 'main']) {
  test(`eşitlik (${via}): 200 düzenleme, HER düzenlemeden sonra okunan projeksiyon ve CP satırları eski yolla aynı`, withEnv({ BL_PROJECTION_REWRITE_WORKER: via === 'main' ? '0' : null }, async () => {
    const fixture = buildFixture({ rows: 400, seed: 21 }), steps = buildSteps(fixture, { count: 200 });
    // Eski yol: her düzenlemede tam yeniden yazım.
    process.env.BL_PROJECTION_PATCH_LOG = '0';
    await seed(`legacy-each-${via}`, fixture);
    const legacy = [];
    for (const [index, step] of steps.entries()) {
      const cpRows = [];
      assert.ok(await pageCache.rewriteGeneration(`legacy-each-${via}`, { fromContextHash: `ctx-${index}`, toContextHash: `ctx-${index + 1}`, transform: legacyTransform(step.items, step.overrides, cpRows) }));
      legacy.push({ hashes: moduleHashes(`legacy-each-${via}`), cpJson: cpRows.json });
    }
    // Yeni yol: kayıt günlüğe eklenir, okuma sıkıştırır.
    process.env.BL_PROJECTION_PATCH_LOG = '1';
    await seed(`log-each-${via}`, fixture);
    for (const [index, step] of steps.entries()) {
      const result = await pageCache.rewriteRowPatches(`log-each-${via}`, patchArgs(step, index));
      assert.equal(result.info.via, 'patch-log');
      assert.ok(pageCache.loadManifest(`log-each-${via}`).patchLog.entries >= 1, 'kayıt yalnız günlüğe eklendi');
      const read = await readHashes(`log-each-${via}`, `ctx-${index + 1}`);
      assert.deepEqual(read, legacy[index].hashes.modules, `düzenleme ${index + 1}: okunan içerik`);
      assert.deepEqual(moduleHashes(`log-each-${via}`), legacy[index].hashes, `düzenleme ${index + 1}: manifest`);
      assert.equal(await deferredJson(result), legacy[index].cpJson, `düzenleme ${index + 1}: CP satırları`);
    }
  }));
}

test('birikmiş günlük: 200 kayıt okumasız kuyruğa girer, giriş sınırı aşılmadan eşikte sıkıştırılır; son durum ve her kaydın CP satırları eski yolla aynı', withEnv({ BL_PROJECTION_PATCH_LOG: '1', BL_PROJECTION_PATCH_LOG_MAX_ENTRIES: 2 }, async () => {
  const fixture = buildFixture({ rows: 300, seed: 23 }), steps = buildSteps(fixture, { count: 200 });
  process.env.BL_PROJECTION_PATCH_LOG = '0';
  await seed('legacy-burst', fixture);
  const legacyCp = [];
  for (const [index, step] of steps.entries()) {
    const cpRows = [];
    await pageCache.rewriteGeneration('legacy-burst', { fromContextHash: `ctx-${index}`, toContextHash: `ctx-${index + 1}`, transform: legacyTransform(step.items, step.overrides, cpRows) });
    legacyCp.push(cpRows.json);
  }
  process.env.BL_PROJECTION_PATCH_LOG = '1';
  await seed('log-burst', fixture);
  const before = pageCache.patchLogStats();
  const results = await Promise.all(steps.map((step, index) => pageCache.rewriteRowPatches('log-burst', patchArgs(step, index))));
  const after = pageCache.patchLogStats();
  assert.ok(after.maxEntries <= 2, `giriş sınırı: ${after.maxEntries}`); // ardışık kayıtlar tek girişte birleşir (≤64 adım)
  assert.ok(after.compactions - before.compactions >= 1, 'eşik sıkıştırması çalıştı');
  await readHashes('log-burst', 'ctx-200');
  assert.deepEqual(moduleHashes('log-burst'), moduleHashes('legacy-burst'));
  assert.deepEqual(await Promise.all(results.map(deferredJson)), legacyCp);
}));

test('boşta sıkıştırma: okuma olmadan günlük kendiliğinden boşalır', withEnv({ BL_PROJECTION_PATCH_LOG: '1', BL_PROJECTION_PATCH_LOG_IDLE_MS: 50 }, async () => {
  const fixture = buildFixture({ rows: 60, seed: 4 }), steps = buildSteps(fixture, { count: 3 });
  await seed('idle-user', fixture);
  for (const [index, step] of steps.entries()) await pageCache.rewriteRowPatches('idle-user', patchArgs(step, index));
  assert.equal(pageCache.loadManifest('idle-user').patchLog.entries, 3);
  for (let i = 0; i < 100 && pageCache.loadManifest('idle-user').patchLog; i++) await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(pageCache.loadManifest('idle-user').patchLog, undefined, 'günlük boşta sıkıştırıldı');
  assert.equal(pageCache.loadManifest('idle-user').contextHash, 'ctx-3');
}));

test('yırtık günlük: önbellek atılır (kaynaktan yeniden üretilir), bayat veri sunulmaz', withEnv({ BL_PROJECTION_PATCH_LOG: '1' }, async () => {
  const fixture = buildFixture({ rows: 40, seed: 6 }), steps = buildSteps(fixture, { count: 3 });
  await seed('torn-user', fixture);
  for (const [index, step] of steps.entries()) await pageCache.rewriteRowPatches('torn-user', patchArgs(step, index));
  const manifest = pageCache.loadManifest('torn-user'), file = path.join(pageCache.ROOT, 'torn-user', manifest.activeGeneration, 'patches.log');
  fs.truncateSync(file, manifest.patchLog.bytes - 5);
  const warn = console.warn; console.warn = () => {};
  try { assert.equal(await pageCache.readProjectionCompressed('torn-user', 'cp', 'ctx-3'), null); } finally { console.warn = warn; }
  assert.equal(pageCache.loadManifest('torn-user'), null, 'kullanıcı önbelleği atıldı');
}));

test('çökme kalıntısı: manifestin bilmediği fazladan günlük baytı sonraki eklemede kesilir, sonuç eski yolla aynı', withEnv({ BL_PROJECTION_PATCH_LOG: '1' }, async () => {
  const fixture = buildFixture({ rows: 50, seed: 8 }), steps = buildSteps(fixture, { count: 3 });
  process.env.BL_PROJECTION_PATCH_LOG = '0';
  await seed('crash-legacy', fixture);
  for (const [index, step] of steps.entries()) await pageCache.rewriteGeneration('crash-legacy', { fromContextHash: `ctx-${index}`, toContextHash: `ctx-${index + 1}`, transform: legacyTransform(step.items, step.overrides, null) });
  process.env.BL_PROJECTION_PATCH_LOG = '1';
  await seed('crash-user', fixture);
  await pageCache.rewriteRowPatches('crash-user', patchArgs(steps[0], 0));
  const manifest = pageCache.loadManifest('crash-user');
  fs.appendFileSync(path.join(pageCache.ROOT, 'crash-user', manifest.activeGeneration, 'patches.log'), '{"v":1,"from":"ctx-1","to":"ctx-9","st');
  await pageCache.rewriteRowPatches('crash-user', patchArgs(steps[1], 1));
  await pageCache.rewriteRowPatches('crash-user', patchArgs(steps[2], 2));
  await readHashes('crash-user', 'ctx-3');
  assert.deepEqual(moduleHashes('crash-user'), moduleHashes('crash-legacy'));
}));

test('bekleyen günlüklü yedek (.bak) manifest güncel veri olarak sunulmaz', withEnv({ BL_PROJECTION_PATCH_LOG: '1' }, async () => {
  const fixture = buildFixture({ rows: 40, seed: 10 }), steps = buildSteps(fixture, { count: 2 });
  await seed('bak-user', fixture);
  for (const [index, step] of steps.entries()) await pageCache.rewriteRowPatches('bak-user', patchArgs(step, index));
  await pageCache.readProjectionCompressed('bak-user', 'cp', 'ctx-2'); // sıkıştırma: .bak = bekleyen günlüklü eski manifest
  const backup = JSON.parse(fs.readFileSync(pageCache.manifestPath('bak-user') + '.bak', 'utf8'));
  assert.ok(backup.patchLog && backup.patchLog.entries > 0, '.bak bekleyen günlük taşıyor');
  const manifest = pageCache.loadManifest('bak-user');
  fs.writeFileSync(path.join(pageCache.ROOT, 'bak-user', manifest.activeGeneration, 'cp.json.gz'), 'bozuk');
  assert.equal(await pageCache.readProjectionCompressed('bak-user', 'cp', 'ctx-2'), null, 'taban baytları (eski içerik) sunulmadı');
}));

test('araya giren mutasyon önce sıkıştırır: kayıt → modül yazımı → kayıt, eski yolla aynı', withEnv({ BL_PROJECTION_PATCH_LOG: '1' }, async () => {
  const fixture = buildFixture({ rows: 80, seed: 5 }), steps = buildSteps(fixture, { count: 2 }), extraCatalog = { values: ['between'] };
  process.env.BL_PROJECTION_PATCH_LOG = '0';
  await seed('mut-legacy', fixture);
  await pageCache.rewriteGeneration('mut-legacy', { fromContextHash: 'ctx-0', toContextHash: 'ctx-1', transform: legacyTransform(steps[0].items, steps[0].overrides, null) });
  await pageCache.writeProjection('mut-legacy', 'collection-catalog', 'ctx-1', extraCatalog);
  await pageCache.rewriteGeneration('mut-legacy', { fromContextHash: 'ctx-1', toContextHash: 'ctx-2', transform: legacyTransform(steps[1].items, steps[1].overrides, null) });
  process.env.BL_PROJECTION_PATCH_LOG = '1';
  await seed('mut-log', fixture);
  const [, written] = await Promise.all([
    pageCache.rewriteRowPatches('mut-log', patchArgs(steps[0], 0)),
    pageCache.writeProjection('mut-log', 'collection-catalog', 'ctx-1', extraCatalog),
    pageCache.rewriteRowPatches('mut-log', patchArgs(steps[1], 1)),
  ]);
  assert.ok(written);
  await readHashes('mut-log', 'ctx-2');
  assert.deepEqual(moduleHashes('mut-log'), moduleHashes('mut-legacy'));
}));

test('Backlog varyantları eski yoldaki gibi kayıttan sonra kullanılmaz', withEnv({ BL_PROJECTION_PATCH_LOG: '1' }, async () => {
  const fixture = buildFixture({ rows: 30, seed: 12 }), steps = buildSteps(fixture, { count: 1 });
  await seed('backlog-user', fixture);
  await pageCache.writeBacklog('backlog-user', 'ctx-0', 'abc', { rows: [1] });
  assert.ok(await pageCache.readBacklog('backlog-user', 'ctx-0', 'abc'));
  await pageCache.rewriteRowPatches('backlog-user', patchArgs(steps[0], 0));
  assert.equal(await pageCache.readBacklog('backlog-user', 'ctx-1', 'abc'), null);
}));

test('bayrak sonradan kapatılırsa bekleyen günlük kaybolmaz: eski yol önce sıkıştırır', withEnv({ BL_PROJECTION_PATCH_LOG: '1' }, async () => {
  const fixture = buildFixture({ rows: 70, seed: 14 }), steps = buildSteps(fixture, { count: 3 });
  process.env.BL_PROJECTION_PATCH_LOG = '0';
  await seed('toggle-legacy', fixture);
  for (const [index, step] of steps.entries()) await pageCache.rewriteGeneration('toggle-legacy', { fromContextHash: `ctx-${index}`, toContextHash: `ctx-${index + 1}`, transform: legacyTransform(step.items, step.overrides, null) });
  process.env.BL_PROJECTION_PATCH_LOG = '1';
  await seed('toggle-user', fixture);
  await pageCache.rewriteRowPatches('toggle-user', patchArgs(steps[0], 0));
  await pageCache.rewriteRowPatches('toggle-user', patchArgs(steps[1], 1));
  process.env.BL_PROJECTION_PATCH_LOG = '0';
  const result = await pageCache.rewriteRowPatches('toggle-user', patchArgs(steps[2], 2));
  assert.notEqual(result.info.via, 'patch-log');
  assert.deepEqual(moduleHashes('toggle-user'), moduleHashes('toggle-legacy'));
}));

test('bayrak varsayılan KAPALI: günlük yazılmaz, eski yol çalışır', withEnv({ BL_PROJECTION_PATCH_LOG: null }, async () => {
  const fixture = buildFixture({ rows: 20, seed: 16 }), steps = buildSteps(fixture, { count: 1 });
  await seed('default-user', fixture);
  const result = await pageCache.rewriteRowPatches('default-user', patchArgs(steps[0], 0));
  assert.notEqual(result.info.via, 'patch-log');
  assert.equal(pageCache.loadManifest('default-user').patchLog, undefined);
}));

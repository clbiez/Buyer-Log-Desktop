'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const SERVER = fs.readFileSync(path.join(ROOT, 'server', 'server.js'), 'utf8');
const APP = fs.readFileSync(path.join(ROOT, 'public', 'app-main.js'), 'utf8');
const INDEX = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');
const OAB = fs.readFileSync(path.join(ROOT, 'public', 'oab.js'), 'utf8');
const LFL = fs.readFileSync(path.join(ROOT, 'public', 'lfl.js'), 'utf8');
const QUOT_UI = fs.readFileSync(path.join(ROOT, 'public', 'quotations.js'), 'utf8');

const cacheRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'buyerlog-v712-cache-'));
process.env.BUYER_LOG_LOCAL_DATA_ROOT = cacheRoot;
const pageCache = require('../server/lib/page-projection-cache');
test.after(() => fs.rmSync(cacheRoot, { recursive: true, force: true }));

test('v7.12 projection cache is generation-based, context-scoped and keeps one fallback generation', async () => {
  const user = 'buyer-cache-test';
  const first = await pageCache.writeGeneration(user, {
    contextHash: 'scope-a',
    sourceLoadedAt: '2026-08-25T12:00:00.000Z',
    projections: {
      cp: { rows:[{ id:1 }] },
      overview: { rows:[{ kpi:1 }] },
      orders: { rows:[{ id:2 }], orderSummary:[] },
      'collection-catalog': { catalogs:{ season:['S7'] } },
    },
  });
  const hit = await pageCache.readProjection(user, 'cp', 'scope-a');
  assert.equal(hit.hit, true);
  assert.deepEqual(hit.data.rows, [{ id:1 }]);
  assert.equal(await pageCache.readProjection(user, 'cp', 'different-scope'), null, 'authorization/horizon scope mismatch must never reuse cache');

  const second = await pageCache.writeGeneration(user, {
    contextHash: 'scope-a',
    projections: {
      cp: { rows:[{ id:3 }] }, overview:{rows:[]}, orders:{rows:[],orderSummary:[]}, 'collection-catalog':{catalogs:{}},
    },
  });
  assert.equal(second.previousGeneration, first.activeGeneration);
  const dirs = fs.readdirSync(path.join(pageCache.ROOT, pageCache.safeUserId(user)), { withFileTypes:true }).filter(item=>item.isDirectory()).map(item=>item.name);
  assert.ok(dirs.includes(second.activeGeneration));
  assert.ok(dirs.includes(first.activeGeneration));
  assert.ok(dirs.length <= 2, 'unbounded generations must not accumulate');

  // Aynı generation üzerinde tek-modül güncellemesi backup manifest'i ezmemeli.
  await pageCache.writeProjection(user, 'orders', 'scope-a', { rows:[{ id:9 }], orderSummary:[] });
  fs.writeFileSync(path.join(pageCache.ROOT, pageCache.safeUserId(user), second.activeGeneration, 'cp.json.gz'), Buffer.from('corrupt-active-cache'));
  const fallback = await pageCache.readProjection(user, 'cp', 'scope-a');
  assert.equal(fallback.hit, true);
  assert.equal(fallback.fallback, true, 'corrupt active generation should use the previous successful generation');
  assert.deepEqual(fallback.data.rows, [{ id:1 }]);
  assert.equal(await pageCache.readProjection(user, 'cp', 'different-scope'), null, 'fallback must never cross authorization/horizon context');
});

test('v7.12 startup path prefers page cache and refresh builds projections instead of ASAS images', () => {
  assert.match(SERVER, /async function buildAndWritePageProjectionCache/);
  assert.match(SERVER, /async function loadCachedPageProjectionSet/);
  assert.match(SERVER, /if \(cached\.hit\)/);
  assert.match(SERVER, /pageCache:\s*\{\s*hit:\s*pageCacheHit/);
  const refresh = SERVER.slice(SERVER.indexOf('async function performRefresh'), SERVER.indexOf("app.get('/api/refresh-status'"));
  assert.match(refresh, /markPhase\('page-cache'\)/);
  assert.match(refresh, /buildAndWritePageProjectionCache/);
  assert.doesNotMatch(refresh, /syncAsasTechnicalImages/);
  assert.doesNotMatch(refresh, /markPhase\('asas-images'\)/);
  // Migration helper may remain available, but it must never run in the HTTP
  // startup path because its synchronous projection builders can starve login.
  assert.match(SERVER, /warmPageProjectionCachesFromSnapshots/);
  assert.doesNotMatch(SERVER, /setTimeout\(\(\)=>warmPageProjectionCachesFromSnapshots\(/);
  const listenStartup = SERVER.slice(SERVER.indexOf('const httpServer = app.listen'), SERVER.indexOf("httpServer.on('error'"));
  assert.doesNotMatch(listenStartup, /ensureDataLoaded\('moderator'\)\.catch\(err=>logRuntimeFailure\('startupModelRead'/, 'authentication startup must not hydrate the large moderator snapshot');
  assert.match(SERVER, /if \(profile\.id !== 'moderator'\) resetUserCache\(profile\.id\)/);
});

/* v7.33 — UPDATED, NOT REMOVED (§156). The intent is unchanged: the OAB
   progress counter must be a LIVE, finely-ticking elapsed readout rather than
   a coarse MM:SS clock. Only the unit changed — the user asked for every
   counter to read like "30,5 sn", so the raw-millisecond text was replaced by
   the shared formatter. The live-tick and no-MM:SS assertions stay. */
test('v7.12/v7.33 OAB Get/Refresh progress is a live elapsed counter in the shared format, not MM:SS', () => {
  assert.match(OAB, /function oabBusyElapsedMs\(\)/);
  assert.match(OAB, /performance\.now\(\) - S\.busyStartedAt/);
  assert.match(OAB, /function oabBusyElapsedText\(\)/);
  assert.match(OAB, /global\.fmtDurationSn\(ms\)/, 'uygulamanın ortak sayaç biçimini kullanmalı');
  assert.match(OAB, /\$\{oabBusyElapsedText\(\)\}/, 'durum satırı canlı geçen süreyi yazmalı');
  assert.match(OAB, /setInterval\([\s\S]*?, 50\)/);
  const busyBlock = OAB.slice(OAB.indexOf('function oabBusyElapsedMs'), OAB.indexOf('function defaultPivotConfigClient'));
  assert.doesNotMatch(busyBlock, /MM:SS|padStart\(2/);
});

test('v7.12 Collection right-button pan coalesces pointer moves into one animation frame', () => {
  assert.match(INDEX, /function applyPanFrame\(\)/);
  assert.match(INDEX, /requestAnimationFrame\(applyPanFrame\)/);
  assert.match(INDEX, /latestX:event\.clientX,latestY:event\.clientY/);
  const move = INDEX.slice(INDEX.indexOf("window.addEventListener('pointermove'"), INDEX.indexOf("window.addEventListener('pointerup'"));
  assert.doesNotMatch(move, /scrollLeft=/, 'pointermove must not write layout on every mouse event');
  assert.match(INDEX, /holdCollectionFastScroll\(\)/);
});

test('v7.12 Collection Notes propagate to rows with the same normalized PLM in one commit', () => {
  const block = APP.slice(APP.indexOf('function commitKolEditor'), APP.indexOf('function finishKolCellEditing'));
  assert.match(block, /if\(k==='not'&&!variantOverrideEdit\)/);
  assert.match(block, /kolPlmNormalizeId\(row\.plmId\)/);
  assert.match(block, /kolRows\.forEach\(peer=>\{[\s\S]*?kolPlmNormalizeId\(peer\.plmId\)!==plmKey[\s\S]*?kolHasVariantOverride\(peer,'not'\)[\s\S]*?peer\.not=val;/);
  assert.match(block, /if\(pushUndo\)kolPushUndo\(\)/);
});

test('v7.12 LFL breakdown order supports drag and arrow reordering without reloading source data', () => {
  const block = LFL.slice(LFL.indexOf('function renderBreakdownPanel'), LFL.indexOf('function toggleBreakdownPanel'));
  assert.match(block, /const moveBreakdown=\(from,to\)=>/);
  assert.match(block, /data-breakdown-up/);
  assert.match(block, /data-breakdown-down/);
  assert.match(block, /dragstart/);
  assert.match(block, /drop/);
  assert.match(block, /saveFilters\(\);render\(\);renderBreakdownPanel\(\)/);
  assert.doesNotMatch(block, /load\(true\)/, 'reorder itself must not query/reload source data');
});

test('v7.12 Product Main Definition is a first-class Collection column and PLM import field', () => {
  assert.match(APP, /\{k:'productMainDefinition', label:'Product Main Definition'/);
  assert.match(APP, /productMainDefinition:source\.productMainDefinition/);
  assert.match(APP, /'productMainDefinition'/);
  assert.match(APP, /'Product Main Definition':'Ürün Ana Tanım'/);
});

test('PLM Sync görsel akışı: mod seçimi korunur, link eşitlemesi aynı komuta bağlandı', () => {
  for (const prefix of ['cp','orders','kol']) {
    assert.match(INDEX, new RegExp(`id="${prefix}PlmSyncBtn"`));
  }
  /* v11.10 — kaynak seçimi modala GERİ DÖNDÜ (kullanıcı kararı): görsel
     komutu artık linkten bağımsızdır, bu yüzden hangi üst kaynağın
     kullanılacağı açıkça sorulur ve SIKI uygulanır. Korunan regresyon: mod
     seçimi (missing/selected/all) kaybolmadı. */
  assert.match(APP, /data-image-source="asas"/);
  assert.match(APP, /data-image-source="plm"/);
  assert.match(APP, /function openModelImageSourceChooser/);
  assert.match(APP, /data-image-mode="all"/);
  assert.match(APP, /Tümünü Yenile/);
  assert.match(APP, /data-image-mode="missing"/);
  assert.match(APP, /Eksikleri Tamamla/);
  assert.match(APP, /data-image-mode="selected"/);
  assert.match(SERVER, /app\.post\('\/api\/plm-style-links\/sync-links'/);
  assert.match(SERVER, /app\.post\('\/api\/model-images\/import-plm'/);
  assert.match(SERVER, /app\.post\('\/api\/model-images\/import-asas'/);
  assert.match(SERVER, /MODEL_IMAGE_IMPORT_BUSY/);
});

test('v7.12 quotation Delete is user-scoped hide and UI no longer says irreversible', () => {
  assert.match(SERVER, /quotationStore\.hideRequest\(req\.currentUser, req\.params\.id\)/);
  assert.match(SERVER, /QUOTATION_HIDE/);
  assert.match(SERVER, /\/api\/quotations\/:id\/restore/);
  assert.match(QUOT_UI, /yalnızca sizin görünümünüzden kaldırılacaktır/);
  assert.doesNotMatch(QUOT_UI, /Bu işlem geri alınamaz/);
});

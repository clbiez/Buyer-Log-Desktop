'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');

const ROOT = path.join(__dirname, '..');
const cacheRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'buyerlog-v714-perf-'));
process.env.BUYER_LOG_LOCAL_DATA_ROOT = cacheRoot;
const pageCache = require('../server/lib/page-projection-cache');
const SERVER = fs.readFileSync(path.join(ROOT, 'server', 'server.js'), 'utf8');
const APP = fs.readFileSync(path.join(ROOT, 'public', 'app-main.js'), 'utf8');
const PERF = fs.readFileSync(path.join(ROOT, 'public', 'perf-runtime.js'), 'utf8');

test.after(() => fs.rmSync(cacheRoot, { recursive:true, force:true }));

test('v7.14 cache hit exposes the validated gzip payload without parse/serialize', async () => {
  await pageCache.writeGeneration('buyer-a', {
    contextHash:'secure-scope-a',
    projections:{ cp:{ rows:[{id:1,name:'Model A'}], cpModelColumns:[] } },
  });
  const first = await pageCache.readProjectionCompressed('buyer-a', 'cp', 'secure-scope-a');
  assert.equal(first.hit, true);
  assert.deepEqual(JSON.parse(zlib.gunzipSync(first.buffer)), { rows:[{id:1,name:'Model A'}], cpModelColumns:[] });
  const second = await pageCache.readProjectionCompressed('buyer-a', 'cp', 'secure-scope-a');
  assert.equal(second.memoryHit, true, 'bounded compressed LRU should avoid a second disk read');
  assert.equal(await pageCache.readProjectionCompressed('buyer-a', 'cp', 'another-scope'), null, 'direct gzip path must keep context isolation');
});

test('v7.14 duplicate generation work is single-flight per user/context/module set', async () => {
  const args={contextHash:'scope-b',projections:{overview:{rows:[{id:2}]}}};
  const [a,b,c]=await Promise.all([
    pageCache.writeGeneration('buyer-b',args),
    pageCache.writeGeneration('buyer-b',args),
    pageCache.writeGeneration('buyer-b',args),
  ]);
  assert.equal(a.activeGeneration,b.activeGeneration);
  assert.equal(b.activeGeneration,c.activeGeneration);
});

test('v7.14 startup keeps projection parsing out of the critical path and lazy-loads active data', () => {
  assert.match(SERVER, /if \(startup\) return \{ ctx, hit: false, manifest \}/);
  assert.match(SERVER, /const wanted = \['cp','overview','orders','collection-catalog'\]/);
  assert.match(SERVER, /readProjectionCompressed\(ctx\.id, module, ctx\.contextHash\)/);
  assert.match(SERVER, /Content-Encoding', 'gzip'/);
  assert.match(SERVER, /pageProjectionBuildInFlight/);
  assert.match(APP, /function ensureCpLoaded/);
  assert.match(APP, /function ensureCollectionCatalogLoaded/);
  assert.match(APP, /requestIdleCallback/);
  assert.match(APP, /function fetchOrdersProjection/);
  assert.match(APP, /fetch\('\/api\/data\/orders'/);
});

test('v7.14 development metrics cover server timing, parse, hydrate, filters, render and first interaction', () => {
  assert.match(SERVER, /Server-Timing/);
  for (const metric of ['bootstrapFetchMs','bootstrapJsonParseMs','stateHydrateMs','filterInitializationMs','firstRenderMs','firstUsableInteractionMs']) {
    assert.match(APP, new RegExp(metric));
  }
  assert.match(PERF, /PerformanceObserver/);
  assert.match(PERF, /longTaskMs/);
  assert.match(PERF, /snapshot/);
});

test('v7.14 visual metadata does not invalidate large business projections', () => {
  const context = SERVER.slice(SERVER.indexOf('function pageProjectionContext'), SERVER.indexOf('function pageCacheRuntimeMeta'));
  assert.match(context, /projectionOverrideRevisions/);
  assert.doesNotMatch(context, /overridesRevision:\s*Number\(shared\._revision/);
  assert.doesNotMatch(context, /imagemap|plmStyleLinks|modelImages/);
});

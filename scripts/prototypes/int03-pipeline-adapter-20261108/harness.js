'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { PassThrough } = require('node:stream');
const { performance } = require('node:perf_hooks');
const { root, fixture } = require('./pinned');
const scratch = path.join(__dirname, '.scratch');
fs.mkdirSync(scratch, { recursive: true });
const data = fs.mkdtempSync(path.join(scratch, 'data-'));
for (const [key, sub] of Object.entries({ BUYER_LOG_SERVER_DATA_ROOT: 'server', BUYER_LOG_DATA_ROOT: 'app', BUYER_LOG_LOCAL_DATA_ROOT: 'local', BUYER_LOG_TEMP_ROOT: 'tmp' })) {
  process.env[key] = path.join(data, sub); fs.mkdirSync(process.env[key], { recursive: true });
}
process.env.BUYER_LOG_CONFIG_PATH = path.join(data, 'config.json');
process.env.BUYER_LOG_LOCAL_DB = path.join(data, 'local/BuyerLogLocal.db');
const deny = () => { throw new Error('INT03_SYNTHETIC_NETWORK_FORBIDDEN'); };
for (const id of ['node:http', 'node:https']) { const m = require(id); m.get = deny; m.request = deny; }
require('node:net').Socket.prototype.connect = deny;
global.fetch = deny;
const app = rel => require(path.join(root, 'resources/app', rel));
const user = app('server/user-data');
const db = app('server/db');
const owner = app('server/lib/plm-image-ownership');
const baseIngest = app('server/lib/plm-image-ingest');
const baseService = app('server/lib/plm-image-sync-service');
const baseQueue = app('server/lib/plm-image-download-queue');
const adapter = require('./adapter');
const { createRuntime } = require('./runtime');
const tick = () => new Promise(resolve => setImmediate(resolve));
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
function gate() { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; }
function metadata(items) {
  const byCode = new Map(items.map(i => [i.plmId, i]));
  const byStyle = new Map(items.map(i => [i.styleId, i]));
  return {
    styleListLookup: async codes => ({ data: { coreNectumResultData: { styleListResult: codes.map(code => ({ plmCode: code, styleId: byCode.get(code).styleId })) } } }),
    styleImagesLookup: async styleId => { const i = byStyle.get(styleId); return { data: { styleOptionImages: { OptionImages: [{ styleOptionId: styleId, styleOptionImageId: `synthetic-${i.urlId}`, colorCode: i.colourCode, name: i.colour, imageUrl: fixture.url(i.urlId) }] } } }; },
  };
}
function transport(items, hooks = {}) {
  const byUrl = new Map(items.map(i => [fixture.url(i.urlId), i]));
  const attempts = new Map();
  const stats = { starts: 0, active: 0, peakActive: 0, settled: 0, bytes: 0, writableBackpressure: 0, retainedBodies: 0, attempts: {} };
  return { stats, async open(url, options) {
    const i = byUrl.get(url);
    if (!i) throw new Error('Unknown synthetic URL');
    const n = (attempts.get(url) || 0) + 1; attempts.set(url, n);
    stats.attempts[i.urlId] = n;
    stats.starts++; stats.active++; stats.peakActive = Math.max(stats.peakActive, stats.active);
    hooks.onOpen?.(i, n, options);
    const spec = hooks.spec?.(i, n) || {};
    const body = new PassThrough({ highWaterMark: options.highWaterMark });
    // Always attach an error listener, including errors before iterator setup.
    body.on('error', () => {});
    const closed = new Promise(resolve => body.once('close', resolve));
    let stopped = false;
    const session = { status: spec.status || 200,
      headers: { 'content-type': spec.type || 'image/png', ...(spec.chunked ? { 'transfer-encoding': 'chunked' } : { 'content-length': String(spec.length ?? i.size) }), ...spec.headers },
      body, destroy(e) { stopped = true; body.destroy(e); }, settled: null,
    };
    session.settled = (async () => {
      let bytes = null;
      try {
        await tick();
        if (spec.beforeBody) await spec.beforeBody;
        if (stopped) return;
        bytes = fixture.png(spec.size || i.size, i.contentTag); stats.retainedBodies++;
        if (spec.invalid) bytes.fill(60);
        for (let offset = 0; offset < bytes.length; offset += 16384) {
          if (stopped) return;
          if (spec.failAt != null && offset >= spec.failAt) throw Object.assign(new Error('Synthetic reset'), { code: 'ECONNRESET' });
          const chunk = bytes.subarray(offset, Math.min(offset + 16384, bytes.length));
          if (!body.write(chunk)) {
            stats.writableBackpressure++;
            await new Promise(resolve => { const done = () => { body.off('drain', done); body.off('close', done); resolve(); }; body.once('drain', done); body.once('close', done); });
          }
          stats.bytes += chunk.length;
          if (spec.chunkDelay) await delay(spec.chunkDelay);
        }
        if (!stopped) body.end();
      } catch (e) { body.destroy(e); }
      finally {
        await closed;
        if (spec.settleGate) await spec.settleGate;
        if (bytes) stats.retainedBodies--; bytes = null;
        // Destroy drops any readable/writable queue references before settled.
        body.destroy();
        await tick();
        stats.active--; stats.settled++; hooks.onSettle?.(i, n);
      }
    })();
    return session;
  } };
}
function snapshot() { const overrides = db.loadOverrides(); return { store: owner.loadOwnership(), imagemap: overrides.imagemap || {}, revision: Number(overrides._revisions.orders) || 0 }; }
function context(items, options = {}) {
  const arm = options.arm || 'after';
  const runtime = options.runtime || createRuntime({ directory: path.join(data, 'spool'), ...options.runtimeOptions });
  const tr = transport(items, options.transportHooks);
  const metrics = { patchCalls: 0, firstCanonicalLinkMs: null, downloadsAtFirstLink: null, totalMs: null, entryReads: 0, checkpoints: [], expectedRevisions: [], trace: [] };
  let start = 0;
  const deps = { ownership: owner, getImage: user.getCollectionImage, readImageBytes: found => fs.readFileSync(found.full), deleteImage: user.deleteCollectionImage,
    saveImage: payload => { if (options.writeDelayMs) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, options.writeDelayMs); if (options.failSave?.(payload)) throw Object.assign(new Error('Synthetic storage failure'), { code: 'SYNTHETIC_STORAGE_FAILURE' }); const x = user.saveCollectionImage(payload); options.onSave?.(x, payload); return x; },
    patchLinks: (links, revision) => {
      metrics.expectedRevisions.push(revision ?? null);
      if (options.patchFailure) throw Object.assign(new Error('Synthetic patch failure'), { code: 'SYNTHETIC_PATCH_FAILURE' });
      const saved = db.patchPlmImageLinks(links, revision);
      metrics.patchCalls++;
      if (metrics.firstCanonicalLinkMs === null && links.length) {
        const found = user.getCollectionImage(saved.overrides.imagemap[baseIngest.canonicalKeyFor(links[0])]);
        if (!found) throw new Error('Missing durable linked image');
        fs.accessSync(found.full); metrics.firstCanonicalLinkMs = performance.now() - start; metrics.downloadsAtFirstLink = tr.stats.settled;
      }
      options.onPatch?.(links, saved);
      return saved;
    },
  };
  const ingest = arm === 'before' ? baseIngest.createPlmImageIngest(deps) : adapter.createIngest(deps);
  const before = snapshot();
  const input = { requests: items, mode: 'all', ...metadata(items), ingest, snapshot,
    store: before.store, imagemap: before.imagemap, transport: tr, signal: options.signal,
    isCancelled: options.isCancelled, dropOldFiles: options.dropOldFiles,
    downloadConcurrency: options.concurrency || 8,
    beforeCommitEntry: async entry => { metrics.entryReads++; if (options.slowCommitMs) await delay(options.slowCommitMs); if (options.beforeCommitEntry) await options.beforeCommitEntry(entry, runtime); },
    downloadOptions: { maxAttempts: 4, sleep: async () => { if (options.signal?.aborted) throw Object.assign(new Error('Cancelled'), { code: 'PLM_JOB_CANCELLED' }); }, random: () => 0, ...options.downloadOptions },
    checkpoint: options.checkpoint || { bump() {}, set() {}, fail(x) { metrics.checkpoints.push({ kind: 'fail', key: baseIngest.canonicalKeyFor(x) }); }, phase() {}, complete(x) {
      if (x.status && x.status !== 'manual-preserved') {
        const ref = snapshot().imagemap[baseIngest.canonicalKeyFor(x)];
        if (!ref || !user.getCollectionImage(ref)) throw new Error('Checkpoint before durable link');
      }
      metrics.checkpoints.push({ kind: 'complete', key: baseIngest.canonicalKeyFor(x) });
    } },
  };
  // Both arms use the same stream transport and validation. Only lifecycle and
  // canonical staged ingestion differ; this is a prototype comparison.
  input.downloadImage = async (url, options) => baseQueue.downloadImage(url, { ...options, ...input.downloadOptions,
    request: async safe => require('./stream-request').streamRequest(safe, { transport: tr, signal: input.signal,
      permit: { checkBodySize() {} }, runtime: null }),
  });
  return { runtime, transport: tr, metrics, ingest, input, async run() {
    start = performance.now(); metrics.startedAt = start;
    try { return arm === 'before' ? await baseService.runPlmImageSync(input) : await adapter.run(input, runtime); }
    finally { metrics.totalMs = performance.now() - start; }
  } };
}
function output(items) {
  const snap = snapshot();
  return items.map(i => {
    const key = baseIngest.canonicalKeyFor(i), ref = snap.imagemap[key], found = ref && user.getCollectionImage(ref);
    return { key, hash: found ? fixture.hash(fs.readFileSync(found.full)) : null, ref: ref || null };
  });
}
function cleanup() { fs.rmSync(data, { recursive: true, force: true }); }
module.exports = { context, data, user, db, owner, baseIngest, baseService, baseQueue, snapshot, output, cleanup, fixture, tick, delay, gate, createRuntime };

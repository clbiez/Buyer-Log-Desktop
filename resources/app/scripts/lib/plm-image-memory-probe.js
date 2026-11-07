'use strict';

// Diagnostic entry point only. Never required by application code.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { performance } = require('node:perf_hooks');
const { fixture, png, url, hash } = require('./plm-image-memory-fixture');

async function probe(scenario = 'baseline') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'buyer-int03-synthetic-'));
  for (const [key, subdir] of Object.entries({
    BUYER_LOG_SERVER_DATA_ROOT: 'server', BUYER_LOG_DATA_ROOT: 'app',
    BUYER_LOG_LOCAL_DATA_ROOT: 'local', BUYER_LOG_TEMP_ROOT: 'tmp',
  })) {
    process.env[key] = path.join(root, subdir);
    fs.mkdirSync(process.env[key], { recursive: true });
  }
  process.env.BUYER_LOG_CONFIG_PATH = path.join(root, 'config.json');
  process.env.BUYER_LOG_LOCAL_DB = path.join(root, 'local/BuyerLogLocal.db');
  // Fail closed if any dependency unexpectedly attempts network I/O.
  const denyNetwork = () => { throw new Error('INT03_SYNTHETIC_NETWORK_FORBIDDEN'); };
  for (const module of ['node:http', 'node:https']) {
    const api = require(module); api.request = denyNetwork; api.get = denyNetwork;
  }
  require('node:net').connect = denyNetwork;
  require('node:net').Socket.prototype.connect = denyNetwork;
  global.fetch = denyNetwork;

  const user = require('../../server/user-data');
  const db = require('../../server/db');
  const owner = require('../../server/lib/plm-image-ownership');
  const ingestLib = require('../../server/lib/plm-image-ingest');
  const service = require('../../server/lib/plm-image-sync-service');
  const queue = require('../../server/lib/plm-image-download-queue');
  const large = scenario === 'baseline';
  const items = fixture(large ? 2048 : scenario === 'retention' ? 24 : 6,
    large ? undefined : [8192, 16384, 32768]);
  if (scenario === 'contracts') {
    items[2].urlId = items[1].urlId;
    items[2].contentTag = items[1].contentTag;
    items[2].size = items[1].size;
    items[4].contentTag = items[3].contentTag;
    items[4].size = items[3].size;
  }
  const report = {
    scenario, fixtureSha256: hash(JSON.stringify(items)), requested: items.length,
    diagnosticBudgetBytes: 128 * 1024, downloads: 0, bytesDownloaded: 0,
    commitCalls: 0, peakCommitInputBytes: 0, firstCanonicalLinkMs: null,
    downloadsAtFirstLink: null, lastDownloadMs: null, samples: [],
  };
  let measuring = false, cancelled = false;
  let started = 0;
  function sample(event) {
    const m = process.memoryUsage();
    report.sampledPeakRssBytes = Math.max(report.sampledPeakRssBytes || 0, m.rss);
    report.sampledPeakExternalBytes = Math.max(report.sampledPeakExternalBytes || 0, m.external);
    report.sampledPeakArrayBufferBytes = Math.max(report.sampledPeakArrayBufferBytes || 0, m.arrayBuffers);
    // Scalar, bounded samples: do not retain images or unbounded trace objects.
    if (report.samples.length < 4096) report.samples.push({ event, ms: performance.now() - started, ...m });
  }
  const ingest = ingestLib.createPlmImageIngest({
    ownership: owner, getImage: user.getCollectionImage,
    saveImage: payload => { const saved = user.saveCollectionImage(payload); if (measuring) sample('save'); return saved; },
    deleteImage: user.deleteCollectionImage,
    readImageBytes: found => fs.readFileSync(found.full),
    patchLinks: links => {
      if (measuring && scenario === 'patch-failure') throw Object.assign(new Error('Synthetic patch failure'), { code: 'SYNTHETIC_PATCH_FAILURE' });
      const saved = db.patchPlmImageLinks(links);
      if (measuring && report.firstCanonicalLinkMs === null && links.length) {
        // Confirm the newly linked image is readable from durable canonical storage.
        const ref = saved.overrides.imagemap[ingestLib.canonicalKeyFor(links[0])];
        if (!user.getCollectionImage(ref)) throw new Error('Canonical link points to a missing file');
        report.firstCanonicalLinkMs = performance.now() - started;
        report.downloadsAtFirstLink = report.downloads;
        sample('first-canonical-link');
      }
      return saved;
    },
  });
  let oldSharedRef, oldUnsharedRef, manualRef;
  if (scenario === 'contracts') {
    manualRef = user.saveCollectionImage({ rowId: 'synthetic-manual', filename: 'manual.png', mimeType: 'image/png', base64: png(512, 999).toString('base64') }).id;
    db.patchPlmImageLinks([{ ...items[0], imageRef: manualRef }]);
  }
  if (scenario === 'drop' || scenario === 'keep') {
    const seed = ingest.commit(items.slice(0, 2).map((i, n) => ({ ...i, buffer: png(512, 1000 + n), sourceType: 'OPTION', sourceIdentity: `old-${n}` })), {
      store: owner.loadOwnership(), imagemap: db.loadOverrides().imagemap,
    });
    [oldSharedRef, oldUnsharedRef] = seed.outcomes.map(i => i.imageRef);
    db.patchPlmImageLinks([{ plmId: '8999999', colourCode: 'ALIAS', colour: 'SYNTHETIC', imageRef: oldSharedRef }]);
  }
  const before = db.loadOverrides();
  report.filesBefore = user.readCollectionImageIndex().length;
  report.ownerCountBefore = Object.keys(owner.loadOwnership().owners).length;
  const byUrl = new Map(items.map(i => [url(i.urlId), i]));
  const completedUrls = new Set();
  const attemptedUrls = [];
  const input = {
    requests: items, mode: 'all', ingest: { ...ingest, commit(entries, options) {
      report.commitCalls++;
      const buffers = new Set(entries.map(i => i.buffer).filter(Buffer.isBuffer));
      report.peakCommitInputBytes = Math.max(report.peakCommitInputBytes, [...buffers].reduce((n, b) => n + b.length, 0));
      sample('commit-input');
      return ingest.commit(entries, options);
    } },
    store: owner.loadOwnership(), imagemap: before.imagemap,
    dropOldFiles: scenario === 'drop', isCancelled: () => cancelled,
    downloadConcurrency: 8,
    styleListLookup: async codes => ({ data: { coreNectumResultData: { styleListResult: codes.map(code => ({ plmCode: code, styleId: items.find(i => i.plmId === code).styleId })) } } }),
    styleImagesLookup: async styleId => {
      const i = items.find(i => i.styleId === styleId);
      return { data: { styleOptionImages: { OptionImages: [{ styleOptionId: styleId, styleOptionImageId: `synthetic-${i.urlId}`, colorCode: i.colourCode, name: i.colour, imageUrl: url(i.urlId) }] } } };
    },
    downloadImage: async (imageUrl, options) => {
      attemptedUrls.push(imageUrl);
      const i = byUrl.get(imageUrl);
      if (!i) throw new Error('Unknown synthetic URL');
      const image = await queue.downloadImage(imageUrl, { ...options, maxAttempts: 1, request: async () => {
        await new Promise(resolve => setTimeout(resolve, 1));
        if (scenario === 'partial' && i.urlId === 2) throw Object.assign(new Error('Synthetic permanent failure'), { code: 'PLM_IMAGE_INVALID_TYPE' });
        return { buffer: png(i.size, i.contentTag), contentType: 'image/png' };
      } });
      completedUrls.add(imageUrl);
      report.downloads++;
      report.bytesDownloaded += image.buffer.length;
      report.lastDownloadMs = performance.now() - started;
      sample('download');
      if (scenario === 'cancel') cancelled = true;
      return image;
    },
  };
  // Cancellation needs a queue larger than the eight active slots.
  if (scenario === 'cancel') input.downloadConcurrency = 2;
  started = performance.now();
  report.initialExternalBytes = process.memoryUsage().external;
  measuring = true;
  sample('start');
  const timer = setInterval(() => sample('timer'), 5);
  try {
    let result;
    try { result = await service.runPlmImageSync(input); }
    catch (error) { report.errorCode = error.code || error.message; }
    report.totalMs = performance.now() - started;
    sample('end');
    // maxRSS is OS high-water (KiB on supported Linux/Node), including startup.
    report.osPeakRssBytes = process.resourceUsage().maxRSS * 1024;
    measuring = false;
    const after = db.loadOverrides();
    report.revisionDelta = after._revisions.orders - before._revisions.orders;
    report.filesAfter = user.readCollectionImageIndex().length;
    report.ownerCountAfter = Object.keys(owner.loadOwnership().owners).length;
    report.manualRefUnchanged = !manualRef || after.imagemap[ingestLib.canonicalKeyFor(items[0])] === manualRef;
    report.oldSharedExists = Boolean(oldSharedRef && user.getCollectionImage(oldSharedRef));
    report.oldUnsharedExists = Boolean(oldUnsharedRef && user.getCollectionImage(oldUnsharedRef));
    if (result) {
      report.status = result.status;
      report.failures = result.failures.length;
      report.manualPreserved = result.counts.manualPreserved;
      report.removedFiles = result.removedFiles;
      report.outcomes = result.outcomes.map(i => ({ key: i.key, status: i.status, hash: i.contentHash, sourceIdentity: i.sourceIdentity }));
      report.oracleMatches = items.every(i => {
        const ref = after.imagemap[ingestLib.canonicalKeyFor(i)];
        if (manualRef && i === items[0]) return ref === manualRef;
        if (!completedUrls.has(url(i.urlId))) return !ref;
        const found = user.getCollectionImage(ref);
        return found && hash(fs.readFileSync(found.full)) === hash(png(i.size, i.contentTag));
      });
      if (scenario === 'contracts') {
        const countBeforeRepeat = report.downloads;
        await service.runPlmImageSync({ ...input, store: owner.loadOwnership(), imagemap: after.imagemap });
        report.repeat = { downloads: report.downloads - countBeforeRepeat, revisionDelta: db.loadOverrides()._revisions.orders - after._revisions.orders };
      }
    }
    report.attemptedUrls = attemptedUrls.length;
    return report;
  } finally {
    clearInterval(timer);
    fs.rmSync(root, { recursive: true, force: true });
  }
}
if (require.main === module) probe(process.argv[2]).then(r => process.stdout.write(JSON.stringify(r) + '\n')).catch(e => { console.error(e); process.exitCode = 1; });
module.exports = { probe };

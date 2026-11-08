'use strict';
// Run under the common flock, once per fresh Node process. No external network.
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { execFileSync } = require('node:child_process');
const Module = require('node:module');
const crypto = require('node:crypto');
const app = path.resolve(__dirname, '../../../../resources/app');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'buyerlog-int03-measure-'));
for (const [key, dir] of Object.entries({ BUYER_LOG_SERVER_DATA_ROOT: 'server', BUYER_LOG_LOCAL_DATA_ROOT: 'local', BUYER_LOG_DATA_ROOT: 'app' })) {
  process.env[key] = path.join(root, dir); fs.mkdirSync(process.env[key]);
}
const sourceFile = path.join(app, 'server/lib/plm-image-sync-service.js');
const baseline = process.argv.includes('--baseline');
const source = baseline ? execFileSync('git', ['show', '511cb2fae629cd6e0c1ad31eb773775e5c95841d:resources/app/server/lib/plm-image-sync-service.js'], { cwd: app, encoding: 'utf8' }) : fs.readFileSync(sourceFile, 'utf8');
const compiled = new Module(sourceFile, module); compiled.filename = sourceFile; compiled.paths = Module._nodeModulePaths(path.dirname(sourceFile)); compiled._compile(source, sourceFile);
const service = compiled.exports;
const { createPlmImageIngest } = require(path.join(app, 'server/lib/plm-image-ingest'));
const ownership = require(path.join(app, 'server/lib/plm-image-ownership'));
const data = require(path.join(app, 'server/user-data'));
const budget = require(path.join(app, 'server/lib/plm-image-byte-budget-int03'));
const MiB = 1024 * 1024;
const start = process.memoryUsage();
let rss = start.rss, arrayBuffers = start.arrayBuffers, external = start.external, rootedBytes = 0;
function sample() { const m = process.memoryUsage(); rss = Math.max(rss, m.rss); arrayBuffers = Math.max(arrayBuffers, m.arrayBuffers); external = Math.max(external, m.external); }
function fixture(job) {
  let imagemap = {}, store = ownership.emptyStore();
  const ingest = createPlmImageIngest({
    ownership: { ...ownership, saveOwnership: value => { store = value; return value; } },
    getImage: data.getCollectionImage,
    readImageBytes: found => fs.readFileSync(found.full),
    saveImage: payload => { sample(); const item = data.saveCollectionImage(payload); sample(); return item; },
    patchLinks: links => { for (const item of links) imagemap[ingest.canonicalKeyFor(item)] = item.imageRef; return { overrides: { imagemap }, updated: links.length }; },
  });
  const commit = ingest.commit;
  ingest.commit = (entries, options) => {
    rootedBytes = Math.max(rootedBytes, [...new Set(entries.map(item => Object.getOwnPropertyDescriptor(item, 'buffer').value).filter(Buffer.isBuffer))].reduce((sum, b) => sum + b.length, 0));
    sample();
    const result = commit(entries, options); sample(); return result;
  };
  return {
    mode: 'all', ingest, imagemap, store,
    requests: Array.from({ length: 40 }, (_, i) => ({ plmId: String(9200000 + job * 100 + i), colourCode: 'TST', colour: 'SYNTHETIC' })),
    styleListLookup: async codes => ({ data: { coreNectumResultData: { styleListResult: codes.map(code => ({ plmCode: code, styleId: code, model: { imageUrl: `https://mym-api.lcwaikiki.com/lcw/live/corenectum/service/api/Attachment/GetAttachment/${code}` } })) } } }),
    styleImagesLookup: async () => ({ data: { styleImages: { StyleImages: [] }, styleOptionImages: { OptionImages: [] } } }),
    downloadImage: async url => {
      const id = Number(url.split('/').pop());
      const buffer = Buffer.alloc((1 + id % 5) * MiB, id % 251);
      Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex').copy(buffer);
      sample(); await new Promise(resolve => setImmediate(resolve));
      return { buffer, mimeType: 'image/png', size: buffer.length };
    },
  };
}
(async () => {
  const timer = setInterval(sample, 5);
  try {
    const result = await Promise.all([0, 1].map(job => service.runPlmImageSync(fixture(job))));
    sample();
    const hashes = result.flatMap(run => run.outcomes.map(item => item.contentHash)).sort();
    console.log(JSON.stringify({ mode: baseline ? 'base-main' : 'post-change', node: process.version, platform: `${process.platform}/${process.arch}`, synthetic: true,
      serviceSha256: crypto.createHash('sha256').update(source).digest('hex'), jobs: 2, imagesPerJob: 40, sizesMiB: [1, 2, 3, 4, 5],
      bytesDownloaded: result.reduce((n, run) => n + run.counts.bytesDownloaded, 0), outcomes: hashes.length,
      contentHashesSha256: crypto.createHash('sha256').update(JSON.stringify(hashes)).digest('hex'),
      before: start, sampledPeak: { rss, arrayBuffers, external }, maxEagerBufferRootsAtCommit: rootedBytes,
      reservation: budget.imageByteBudget.snapshot(), reservationIsRss: false, statuses: result.map(run => run.status),
    }, null, 2));
  } finally { clearInterval(timer); fs.rmSync(root, { recursive: true, force: true }); }
})().catch(error => { console.error(error); process.exitCode = 1; });

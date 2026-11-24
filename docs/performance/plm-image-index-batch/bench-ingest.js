'use strict';
// Usage: node bench-ingest.js <appRoot> <dataDir> <indexEntries> <images> <label>
// Measures the canonical PLM ingest commit with the server's real image store
// wiring (main: sync saveCollectionImage; candidate: deferred + flush barrier).
const fs = require('fs');
const path = require('path');
const { performance, monitorEventLoopDelay } = require('perf_hooks');
const [appRoot, dataDir, entriesArg, imagesArg, label] = process.argv.slice(2);
const ENTRIES = Number(entriesArg), IMAGES = Number(imagesArg);
fs.rmSync(dataDir, { recursive: true, force: true });
for (const d of ['local', 'app', 'server', 'tmp']) fs.mkdirSync(path.join(dataDir, d), { recursive: true });
Object.assign(process.env, {
  BUYER_LOG_LOCAL_DATA_ROOT: path.join(dataDir, 'local'), BUYER_LOG_DATA_ROOT: path.join(dataDir, 'app'),
  BUYER_LOG_SERVER_DATA_ROOT: path.join(dataDir, 'server'), BUYER_LOG_TEMP_ROOT: path.join(dataDir, 'tmp'),
  BUYER_LOG_CONFIG_PATH: path.join(dataDir, 'config.json'),
});
const data = require(path.join(appRoot, 'server/user-data.js'));
const ingestLib = require(path.join(appRoot, 'server/lib/plm-image-ingest.js'));
const ownership = require(path.join(appRoot, 'server/lib/plm-image-ownership.js'));
// Synthetic 20k-30k index (metadata only; files are irrelevant for the write path).
const root = data.COLLECTION_IMAGES_ROOT; fs.mkdirSync(root, { recursive: true });
const now = new Date().toISOString();
const items = Array.from({ length: ENTRIES }, (_, i) => ({ id: `ci_1700000000000_${i.toString(16).padStart(12, '0')}`, rowId: `plm:plm:${100000 + i}|colour:C${i % 50}|name:COLOUR ${i % 50}`, filename: `corenectum-${100000 + i}-C${i % 50}.jpg`, mimeType: 'image/jpeg', size: 20000 + i, storedName: `ci_1700000000000_${i.toString(16).padStart(12, '0')}.jpg`, createdAt: now, updatedAt: now, storageMode: 'original' }));
fs.writeFileSync(path.join(root, 'index.json'), JSON.stringify(items, null, 2));
const indexBytes = fs.statSync(path.join(root, 'index.json')).size;
const flushAvailable = typeof data.flushCollectionImageIndex === 'function';
const ingest = ingestLib.createPlmImageIngest({
  ownership,
  getImage: ref => data.getCollectionImage(ref),
  saveImage: flushAvailable ? p => data.saveCollectionImageDeferred(p) : p => data.saveCollectionImage(p),
  deleteImage: flushAvailable ? r => data.deleteCollectionImageDeferred(r) : r => data.deleteCollectionImage(r),
  flushImages: flushAvailable ? () => data.flushCollectionImageIndex() : undefined,
  patchLinks: links => ({ overrides: { imagemap: Object.fromEntries(links.map(l => [ingestLib.canonicalKeyFor(l), l.imageRef])) }, updated: links.length }),
  readImageBytes: found => fs.readFileSync(found.full),
});
const jpeg = n => { const b = Buffer.alloc(30 * 1024, n % 251); Buffer.from([0xff, 0xd8, 0xff, 0xe0]).copy(b); b.writeUInt32BE(n, 100); return b; };
const entries = Array.from({ length: IMAGES }, (_, n) => ({ plmId: String(900000 + n), colourCode: 'C1', colour: 'NAVY', sourceType: 'OPTION', sourceIdentity: 'option:' + n, buffer: jpeg(n), mimeType: 'image/jpeg' }));
// fs op counters
const counts = {};
const wrap = (obj, name, key) => { const orig = obj[name]; obj[name] = function () { counts[key] = (counts[key] || 0) + 1; return orig.apply(this, arguments); }; };
for (const n of ['openSync', 'writeFileSync', 'readFileSync', 'renameSync', 'fsyncSync', 'copyFileSync', 'unlinkSync', 'statSync']) wrap(fs, n, n);
for (const n of ['open', 'writeFile', 'readFile', 'rename', 'copyFile', 'unlink', 'stat']) wrap(fs.promises, n, 'p.' + n);
// warm: first parse of index happens in both (getCollectionImage on startup paths)
data.getCollectionImage('none');
for (const k of Object.keys(counts)) delete counts[k];
const h = monitorEventLoopDelay({ resolution: 1 }); h.enable();
let maxGap = 0, last = performance.now();
const probe = setInterval(() => { const t = performance.now(); maxGap = Math.max(maxGap, t - last); last = t; }, 1);
(async () => {
  const store = ownership.emptyStore();
  const t0 = performance.now();
  const result = await ingest.commit(entries, { store, imagemap: {} });
  if (flushAvailable) await data.flushCollectionImageIndex();
  const total = performance.now() - t0;
  const t = performance.now(); maxGap = Math.max(maxGap, t - last);
  clearInterval(probe); h.disable();
  const onDisk = JSON.parse(fs.readFileSync(path.join(root, 'index.json'), 'utf8')).length;
  const fsOps = Object.values(counts).reduce((a, b) => a + b, 0);
  process.stdout.write(JSON.stringify({ label, entries: ENTRIES, images: IMAGES, indexMB: +(indexBytes / 1048576).toFixed(2), written: result.counts.written, onDisk, totalMs: Math.round(total), longestBlockMs: Math.round(maxGap), eldMaxMs: Math.round(h.max / 1e6), fsOps, counts }) + '\n');
})().catch(e => { console.error(e); process.exit(1); });

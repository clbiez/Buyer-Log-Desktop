'use strict';
/* Projeksiyon satır yaması yeniden yazım işçisi (#1078 takip / WS7b).
   gunzip → JSON.parse → satır yaması adımları → stringifyWithDates → gzip, arka uç ana olay
   döngüsü dışında. Dosya G/Ç'si, atomik yazım ve manifest değişimi ana iş parçacığında kalır
   (page-projection-cache). Mantık lib/projection-rewrite.js'tedir (geri dönüş yoluyla aynı). */
const { parentPort } = require('node:worker_threads');
const zlib = require('node:zlib');
const { performance } = require('node:perf_hooks');
globalThis.BLCanonicalFields = require('../lib/canonical-fields');
const core = require('../lib/projection-rewrite');

// Eski yol: page-projection-cache writeJsonGzip, gzip seviye 4.
const GZIP_LEVEL = 4;

function run({ modules, steps }) {
  const timings = { inflateMs: 0, parseMs: 0, patchMs: 0, serializeMs: 0, deflateMs: 0 };
  const out = [], transfer = [], cpRowsBySteps = steps.map(() => null);
  for (const entry of modules) {
    let t = performance.now();
    const raw = zlib.gunzipSync(entry.buffer);
    entry.buffer = null;
    timings.inflateMs += performance.now() - t; t = performance.now();
    const data = JSON.parse(raw.toString('utf8'));
    timings.parseMs += performance.now() - t; t = performance.now();
    const applied = core.applySteps(entry.module, data, steps);
    timings.patchMs += performance.now() - t;
    applied.cpRowsBySteps.forEach((rows, index) => { if (rows) cpRowsBySteps[index] = rows; });
    if (!applied.changed) { out.push({ module: entry.module, changed: false }); continue; }
    t = performance.now();
    const json = Buffer.from(core.serializeProjection(data), 'utf8');
    timings.serializeMs += performance.now() - t; t = performance.now();
    const compressed = zlib.gzipSync(json, { level: GZIP_LEVEL });
    timings.deflateMs += performance.now() - t;
    // Kendi ArrayBuffer'ı olan kopya: havuz dilimi (Buffer pool) aktarılamaz.
    const owned = new Uint8Array(compressed.length);
    owned.set(compressed);
    transfer.push(owned.buffer);
    out.push({ module: entry.module, changed: true, buffer: owned, uncompressedBytes: json.length });
  }
  return { value: { modules: out, cpRowsBySteps, timings }, transfer };
}

parentPort.on('message', message => {
  if (!message || message.type !== 'run') return;
  try {
    const { value, transfer } = run(message.payload);
    parentPort.postMessage({ type: 'result', id: message.id, ok: true, value }, transfer);
  } catch (error) {
    parentPort.postMessage({ type: 'result', id: message.id, ok: false, error: { message: String(error && error.message || error), code: error && error.code || null } });
  }
});

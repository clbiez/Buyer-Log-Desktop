'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Worker } = require('node:worker_threads');
const XLSX = require('xlsx');
const dates = require('../public/excel-date-utils');

// Same order as excel-worker.execute: parser guards, then date hooks.
require('../server/lib/workbook-parser-guards').install(XLSX);
dates.installSheetJsHooks(XLSX);
const { parseASASWorkbook, parseAntrepoWorkbook, parseCPUpdateWorkbook } = require('../server/lib/parse');
const { parseLFLWorkbook } = require('../server/lib/lfl');
const { build } = require('../scripts/generate-demo-data');

function bytes(aoa, name = 'Demo') {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), name);
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

test('date repair handles sparse and dense cells, holes, invalid dates and timestamps equally', () => {
  function cells() {
    return [
      { t: 'd', v: new Date(2026, 0, 1, 23, 59, 4), w: 'stale' },
      undefined,
      { t: 'd', v: new Date(2026, 0, 2, 0, 0, 56), w: 'stale' },
      { t: 'd', v: new Date(2026, 0, 2, 14, 30), w: 'keep' },
      { t: 'd', v: new Date(NaN) },
      { t: 'n', v: 46024 },
    ];
  }
  const sparseCells = cells(), denseCells = cells();
  const sparse = { '!ref': 'B3:G3' }, dense = { '!ref': 'B3:G3', '!data': [] };
  sparseCells.forEach((cell, i) => { if (cell) sparse[XLSX.utils.encode_cell({ r: 2, c: i + 1 })] = cell; });
  dense['!data'][2] = [undefined, ...denseCells];
  for (const ws of [sparse, dense]) {
    assert.equal(dates.repairReadDateCells({ SheetNames: ['S'], Sheets: { S: ws } }, XLSX), 2);
  }
  // Node 22.23 deepStrictEqual iki geçersiz Date'i eşit saymaz (Node 24 sayar);
  // zamanı sayısal karşılaştır: geçersiz tarih iki temsilde de geçersiz kalmalı.
  const comparable = list => list.map(cell => cell && { ...cell, v: cell.v instanceof Date ? `date:${cell.v.getTime()}` : cell.v });
  assert.deepEqual(comparable(denseCells), comparable(sparseCells));
  assert.ok(Number.isNaN(denseCells[4].v.getTime()) && Number.isNaN(sparseCells[4].v.getTime()));
  assert.equal(denseCells[0].v.getTime(), new Date(2026, 0, 2).getTime());
  assert.equal(Object.hasOwn(denseCells[0], 'w'), false);
  assert.equal(denseCells[3].w, 'keep');
});

test('production read hooks repair cellDates:true in both representations', () => {
  // The reader returns Date instants in UTC. Exercise local midnight in each TZ,
  // rather than assuming a UTC serial is local midnight outside UTC.
  const offset = new Date(2026, 0, 2).getTimezoneOffset() / 1440;
  const sheet = XLSX.utils.aoa_to_sheet([['Schedule', 'Timestamp'], [46024 + offset - 56 / 86400, 46024 + offset + 14.5 / 24]]);
  sheet.A2.z = sheet.B2.z = 'dd.mm.yyyy hh:mm:ss';
  const raw = XLSX.write({ SheetNames: ['S'], Sheets: { S: sheet } }, { type: 'buffer', bookType: 'xlsx' });
  const results = [false, true].map(dense => {
    const ws = XLSX.read(raw, { type: 'buffer', cellDates: true, dense }).Sheets.S;
    const row = dense ? ws['!data'][1] : [ws.A2, ws.B2];
    assert.ok(row[0].v instanceof Date);
    assert.equal(row[0].v.getTime(), new Date(2026, 0, 2).getTime());
    assert.equal(row[1].v.getHours(), 14);
    assert.equal(row[1].v.getMinutes(), 30);
    return row.map(cell => cell.v);
  });
  assert.deepEqual(results[1], results[0]);
});

for (const seed of [7, 19, 43]) {
  const demo = build({ rows: 24, seed, today: new Date('2026-11-05T00:00:00Z') });
  const cp = [['Supplier', 'PO', 'PO2', 'Manufacturer FOB'],
    ['DEMO SUPPLIER', 4100000, 4100001, 12.345],
    [null, 4100002, null, 0], ['OTHER DEMO', '04100003', null, '7.25']];
  for (const [name, aoa, parser, nonempty] of [
    ['ASAS', demo.asas, parseASASWorkbook, result => result.orders.length === 24],
    ['Antrepo', demo.antrepo, parseAntrepoWorkbook, result => Object.keys(result).length > 0],
    ['CPUpdate', cp, parseCPUpdateWorkbook, result => result.sub > 0 && result.fob > 0],
    ['LFL', demo.lfl, parseLFLWorkbook, result => result.rows.length > 0],
  ]) {
    test(`${name} seed=${seed}: sparse/dense parser output is exactly equal with production hook order`, () => {
      const buffer = bytes(aoa, name);
      const sparse = XLSX.read(buffer, { type: 'buffer', cellDates: false, raw: true, dense: false });
      const dense = XLSX.read(buffer, { type: 'buffer', cellDates: false, raw: true, dense: true });
      assert.ok(dense.Sheets[name]['!data']);
      const before = parser(sparse), after = parser(dense);
      assert.ok(nonempty(before), `${name} fixture must exercise actual records`);
      assert.deepEqual(after, before);
      if (name === 'Antrepo') assert.deepEqual(after.__antrepoMeta, before.__antrepoMeta);
    });
  }
}

test('actual worker enables dense for source tasks while buffer date reads stay sparse', { timeout: 30000 }, async () => {
  const app = path.resolve(__dirname, '..');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'buyerlog-dense-scope-'));
  const demo = build({ rows: 8, seed: 7, today: new Date('2026-11-05T00:00:00Z') });
  const files = {};
  for (const [name, aoa] of Object.entries({ ...demo, cp: [['Supplier', 'PO', 'Manufacturer FOB'], ['DEMO', 4100000, 7.25]] })) {
    files[name] = path.join(dir, name + '.xlsx');
    fs.writeFileSync(files[name], bytes(aoa, name));
  }
  // Observe the real guarded reader before the worker installs its date hooks.
  const worker = new Worker(`
    const { parentPort, workerData } = require('node:worker_threads');
    const path = require('node:path');
    const localRequire = require('node:module').createRequire(path.join(workerData.app, 'server/workers/excel-worker.js'));
    const XLSX = localRequire('xlsx');
    localRequire('../lib/workbook-parser-guards').install(XLSX);
    const read = XLSX.read;
    XLSX.read = function(input, options) {
      parentPort.postMessage({ observedRead: { dense: options.dense === true, cellDates: options.cellDates === true } });
      return read.apply(this, arguments);
    };
    localRequire('./excel-worker.js');
  `, { eval: true, workerData: { app } });
  const reads = [], pending = new Map();
  worker.on('message', message => {
    if (message.observedRead) { reads.push(message.observedRead); return; }
    const job = pending.get(message.id);
    if (!job) return;
    pending.delete(message.id);
    if (message.ok) job.resolve(message.result); else job.reject(new Error(message.error.message));
  });
  worker.on('error', error => { for (const job of pending.values()) job.reject(error); pending.clear(); });
  let id = 0;
  const run = (task, payload) => new Promise((resolve, reject) => {
    pending.set(++id, { resolve, reject }); worker.postMessage({ id, task, payload });
  });
  try {
    const loaded = await run('loadSources', { asasPath: files.asas, antrepoPath: files.antrepo, cpupdatePath: files.cp });
    assert.equal(loaded.parsedAsas.orders.length, 8);
    await run('parseAsasFile', { fullPath: files.asas });
    await run('parseAntrepoFile', { fullPath: files.antrepo });
    await run('parseLflFile', { fullPath: files.lfl });
    await run('parseLflBuffer', { data: fs.readFileSync(files.lfl) });
    assert.deepEqual(reads, [
      ...Array.from({ length: 6 }, () => ({ dense: true, cellDates: false })),
      { dense: false, cellDates: true },
    ]);
  } finally { await worker.terminate(); fs.rmSync(dir, { recursive: true, force: true }); }
});

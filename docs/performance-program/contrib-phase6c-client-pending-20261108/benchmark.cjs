'use strict';
// Run the parent under flock -n -E 75. Each arm has a fresh process and native
// persistent Web Storage; these are API value bytes, never physical disk bytes.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const { spawnSync } = require('node:child_process'), { performance } = require('node:perf_hooks');
const vm = require('node:vm'), assert = require('node:assert/strict');
const repo = path.resolve(__dirname, '../../..');
const delta = require(path.join(repo, 'resources/app/public/collection-delta-commands.js'));
const journal = require(path.join(repo, 'resources/app/public/collection-delta-pending-journal.js'));
const rowCount = 30000;
function child(arm, edits) {
  if (!global.gc || typeof localStorage === 'undefined') throw new Error('native Storage + --expose-gc required');
  const source = fs.readFileSync(path.join(repo, 'resources/app/public/app-main.js'), 'utf8');
  function fn(name, oneLine = false) { const start = source.indexOf('function ' + name + '('); return source.slice(start, oneLine ? source.indexOf('\n', start) : source.indexOf('\n}', start) + 2); }
  const rows = Array.from({ length: rowCount }, (_, index) => ({ id: index + 1, _rev: 4, quantity: '10' }));
  const baseStructure = JSON.stringify({ columns: [], manufacturers: [], statusCatalog: [], order: rows.map(row => String(row.id)), lflCountryExclusions: [] });
  const current = { ownerId: 'synthetic-owner', clientGeneration: 7, sourceId: 'synthetic-accepted', view: 'single', canEdit: true };
  let writtenValueBytes = 0, writtenKeyBytes = 0, writes = 0, legacy, adapter;
  const storage = { getItem: key => localStorage.getItem(key), setItem(key, value) {
    localStorage.setItem(key, value); writtenValueBytes += Buffer.byteLength(value); writtenKeyBytes += Buffer.byteLength(key); writes++;
  } };
  const config = { storage: journal.createWebStorage(storage), api: delta, getCurrent: () => ({ ...current }), legacyKey: 'bl.collection.pending.synthetic-owner.v1' };
  global.gc(); const sourceHeap = process.memoryUsage().heapUsed, bindingStart = performance.now();
  if (arm === 'legacy') {
    legacy = vm.createContext({ kolWorkspaceOwnerId: current.ownerId, kolWorkspaceCanEdit: true, kolWorkspaceRevision: 4,
      kolBaseline: { ownerId: current.ownerId, rows: new Map(rows.map(row => [String(row.id), row])), structure: baseStructure },
      kolRows: rows.slice(), kolManufacturers: [], kolCustomCols: [], kolLflCountryExclusions: [], kolNextId: rowCount + 1,
      kolStatusEntries: () => [], kolSaveFeedbackByOwner: new Map(), kolSetSaveFeedback() {}, showToast() {}, appLang: 'en', localStorage: storage });
    vm.runInContext(['kolWorkspacePendingKey','kolReadPendingWorkspace'].map(name => fn(name, true)).join('\n') + '\n' +
      ['kolPersistableRow','kolPersistPendingWorkspace'].map(name => fn(name)).join('\n'), legacy);
    assert.equal(legacy.kolPersistPendingWorkspace(), true);
  } else {
    adapter = journal.createPendingJournal(config);
    adapter.bindAccepted({ bindingId: 'benchmark', rows, customColumns: [], workspaceRevision: 4, nextId: rowCount + 1, baseStructure,
      metadata: { manufacturers: [], statusCatalog: [], lflCountryExclusions: [] } });
  }
  const bindingMs = performance.now() - bindingStart, bindingBytes = writtenValueBytes, bindingKeyBytes = writtenKeyBytes, bindingWrites = writes;
  global.gc(); const beforeHeap = process.memoryUsage().heapUsed, beforeRss = process.memoryUsage().rss;
  const bindingRetainedHeapBytes = beforeHeap - sourceHeap;
  writtenValueBytes = 0; writtenKeyBytes = 0; writes = 0;
  let peakHeap = beforeHeap, peakRss = beforeRss;
  const started = performance.now();
  for (let index = 0; index < edits; index++) {
    const rowIndex = rowCount - 1 - index, value = String(20 + index);
    if (arm === 'legacy') {
      legacy.kolRows[rowIndex] = { ...legacy.kolRows[rowIndex], quantity: value };
      assert.equal(legacy.kolPersistPendingWorkspace(), true);
    } else {
      const command = delta.prepareFieldCommand(adapter.getState(), { kind: delta.UNIT, operationId: 'edit-' + index, rowId: rowIndex + 1, writes: [{ key: 'quantity', after: { present: true, value } }] });
      assert.equal(adapter.record(command).localRecorded, true);
    }
    const memory = process.memoryUsage(); peakHeap = Math.max(peakHeap, memory.heapUsed); peakRss = Math.max(peakRss, memory.rss);
  }
  const editMs = performance.now() - started, editBytes = writtenValueBytes, editKeyBytes = writtenKeyBytes, editWrites = writes;
  const beforeGCHeapBytes = process.memoryUsage().heapUsed;
  global.gc(); const retainedHeapDeltaBytes = process.memoryUsage().heapUsed - beforeHeap;
  let restored;
  const restoreHeapBefore = process.memoryUsage().heapUsed, restoreRssBefore = process.memoryUsage().rss, writesBeforeRestore = writes;
  const restoreStart = performance.now();
  if (arm === 'legacy') restored = legacy.kolReadPendingWorkspace(current.ownerId);
  else { restored = journal.createPendingJournal(config); restored.open(); }
  const restoreMs = performance.now() - restoreStart;
  const restoreHeapBeforeGCBytes = process.memoryUsage().heapUsed;
  global.gc();
  const restoreRetainedHeapDeltaBytes = process.memoryUsage().heapUsed - restoreHeapBefore, restoreRssDeltaBytes = process.memoryUsage().rss - restoreRssBefore;
  assert.equal(writes, writesBeforeRestore);
  const finalRows = arm === 'legacy' ? restored.rows : restored.getState().rows;
  for (let i = 0; i < edits; i++) assert.equal(finalRows[rowCount - 1 - i].quantity, String(20 + i));
  const result = { arm, rows: rowCount, edits, bindingMs, bindingBytes, bindingKeyBytes, bindingWrites, bindingRetainedHeapBytes,
    editMs, writtenValueBytes: editBytes, writtenKeyBytes: editKeyBytes, editWrites, retainedHeapDeltaBytes, beforeGCHeapBytes,
    peakHeapUsedBytes: peakHeap, peakHeapIncreaseBytes: peakHeap - beforeHeap, peakRssBytes: peakRss, peakRssIncreaseBytes: peakRss - beforeRss,
    restoreMs, restoreHeapBeforeGCBytes, restoreRetainedHeapDeltaBytes, restoreRssDeltaBytes, restoreWrittenBytes: 0,
    restoreWork: arm === 'legacy' ? 'actual kolReadPendingWorkspace: getItem + JSON.parse only' : 'candidate open: getItem + parse + certification + checkpoint/tail replay',
    candidateStatus: arm === 'candidate' ? adapter.status() : null };
  console.log(JSON.stringify(result));
}
if (process.argv[2] === '--arm') child(process.argv[3], Number(process.argv[4]));
else {
  const disk = fs.statfsSync(__dirname), freeDisk = disk.bavail * disk.bsize;
  if (freeDisk < 512 * 1024 * 1024 || os.freemem() < 512 * 1024 * 1024) throw new Error('ADMISSION_FAILED');
  const results = [], orders = [['legacy','candidate'], ['candidate','legacy'], ['legacy','candidate']];
  for (const edits of [10, 100]) for (let pair = 0; pair < orders.length; pair++) for (const arm of orders[pair]) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'buyerlog-pending-bench-'));
    try {
      const run = spawnSync(process.execPath, ['--expose-gc', '--experimental-webstorage', '--localstorage-file=' + path.join(dir, 'storage'), __filename, '--arm', arm, String(edits)],
        { encoding: 'utf8', cwd: repo, timeout: 55000, maxBuffer: 1024 * 1024 });
      if (run.status !== 0) throw new Error(JSON.stringify({ arm, edits, pair, status: run.status, stderr: run.stderr, stdout: run.stdout }));
      results.push({ pair: pair + 1, order: orders[pair], ...JSON.parse(run.stdout) });
      process.stderr.write(edits + ' edits, pair ' + (pair + 1) + ', ' + arm + ': complete\n');
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  }
  const report = { capturedAt: new Date().toISOString(), node: process.version, platform: process.platform, arch: process.arch,
    cpu: os.cpus()[0].model, logicalCpus: os.cpus().length, totalMemoryBytes: os.totalmem(), admission: { freeDiskBytes: freeDisk, freeMemoryBytes: os.freemem() },
    rows: rowCount, pairsPerCase: 3, work: 'synthetic independent quantity commands and synchronous native Storage calls; no DOM/network/server/full saveKolRows',
    byteDefinition: 'UTF-8 lengths of successful Storage.setItem values and keys; no physical disk/fsync claim',
    memoryDefinition: 'fresh process per arm; forced GC before/after; heap/RSS samples after every edit; loop includes sampling and assertions; values are process-wide, not allocation profiling',
    restoreComparison: 'legacy read/parse only; candidate complete module restore. These restore timings measure different work.', results };
  fs.writeFileSync(path.join(__dirname, 'evidence/measurements.json'), JSON.stringify(report, null, 2) + '\n');
}

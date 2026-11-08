'use strict';
// Synthetic module microbenchmark only. Run under the shared flock, with --expose-gc.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
const { performance } = require('node:perf_hooks');
const repo = path.resolve(__dirname, '../../..');
const { createEditor, groups, pins } = require(path.join(repo, 'resources/app/tests/fixtures/collection-client-delta/actual-editor.cjs'));
const delta = require(path.join(repo, 'resources/app/public/collection-delta-commands.js'));
const group = require(path.join(repo, 'resources/app/public/collection-group-delta.js'));
const groupApi = group.createGroupCommandApi(groups);
if (!global.gc) throw new Error('Run with --expose-gc');
const rowCount = 30000, edits = 10, key = 'cx_design';
const columns = [{ k: key, custom: true, dataType: 'text', label: 'Synthetic design' }];
function fixture() {
  return Array.from({ length: rowCount }, (_, index) => {
    const id = index + 1, grouped = id <= 5;
    return { id, _rev: 4, plmId: 'DEMO-' + id, modelKod: 'Synthetic model ' + id,
      modelGroupIdentity: 'persisted-demo-' + id, inStoreMonth: '2027-01', quantity: String(100 + id % 100),
      modelGroupId: grouped ? 'group-1' : 'single-' + id, modelGroupRole: id === 1 ? 'parent' : grouped ? 'variant' : 'single',
      variantId: 'v-' + id, modelSharedValues: id === 1 ? { cx_design: 'original' } : {},
      variantOverrides: id === 5 ? { cx_design: false } : {}, cx_design: 'original',
      unknownPersisted: { flags: [false, 0, null], text: 'Synthetic retained field '.repeat(3) } };
  });
}
const clone = value => JSON.parse(JSON.stringify(value));
const digest = value => require('node:crypto').createHash('sha256').update(JSON.stringify(value)).digest('hex');
const base = fixture();
assert.deepEqual(groups.normalizeRows(base).rows, base);
const baseBytes = Buffer.byteLength(JSON.stringify(base));
function run(arm, grouped) {
  global.gc();
  const source = clone(base), api = grouped ? groupApi : delta;
  const sourceHeap = process.memoryUsage().heapUsed;
  const setupStart = performance.now();
  let current, editor;
  if (arm === 'legacy') editor = createEditor(source, columns);
  else current = api.createState({ ownerId: 'synthetic-owner', clientGeneration: 1, rows: source, customColumns: columns, nextId: rowCount + 1 });
  const setupMs = performance.now() - setupStart;
  global.gc();
  const beforeHeap = process.memoryUsage().heapUsed;
  const started = performance.now();
  const commands = [];
  for (let i = 0; i < edits; i++) {
    const value = 'edit-' + i, rowId = grouped ? 1 : rowCount;
    if (arm === 'legacy') assert.equal(editor.edit(rowId, key, value), true);
    else {
      const command = grouped
        ? api.prepareGroupUnit(current, { kind: group.KIND, operationId: 'edit-' + i, action: 'cell-edit', rowId, key, value })
        : api.prepareFieldCommand(current, { kind: delta.UNIT, operationId: 'edit-' + i, rowId, writes: [{ key, after: { present: true, value } }] });
      current = grouped ? api.applyGroupUnit(current, command) : api.applyFieldCommand(current, command);
      commands.push(command);
    }
  }
  const editMs = performance.now() - started;
  global.gc();
  const retainedHeapDelta = process.memoryUsage().heapUsed - beforeHeap;
  const rows = arm === 'legacy' ? editor.context.kolRows : current.rows;
  const finalDigest = digest(rows);
  // Output and identity validation are outside the timed edit region.
  assert.equal(rows[grouped ? 0 : rowCount - 1][key], 'edit-9');
  let historyBytes, transportMs = null, payloadBytes = null, touchedRows;
  if (arm === 'legacy') {
    assert.equal(editor.context.kolUndoStack.length, edits);
    historyBytes = Buffer.byteLength(JSON.stringify(editor.context.kolUndoStack));
    touchedRows = rows.reduce((sum, row, index) => sum + (row !== source[index]), 0);
  } else {
    assert.deepEqual(current.history.undo, []); // no simulated durability/ACK inside edit timing
    const retainedHistory = commands;
    historyBytes = Buffer.byteLength(JSON.stringify(retainedHistory));
    touchedRows = rows.reduce((sum, row, index) => sum + (row !== source[index]), 0);
    const transportStarted = performance.now();
    const request = api.materializeLegacyRequest(current, commands.map(command => command.operationId), { requestId: 'micro', atomic: grouped });
    transportMs = performance.now() - transportStarted;
    payloadBytes = Buffer.byteLength(JSON.stringify(request.payload));
    assert.equal(request.payload.upserts.length, grouped ? 4 : 1);
    assert.equal(request.payload.upserts[0][key], 'edit-9');
    const accepted = api.acknowledgeLegacyResponse(current, request, { ok: true, revision: 100, conflicts: [],
      applied: request.payload.upserts.map(row => ({ id: String(row.id), kind: 'changed', rev: 5 })) });
    const inverse = api.prepareUndo(accepted, 'inverse-check');
    const undone = grouped ? api.applyGroupUnit(accepted, inverse) : api.applyFieldCommand(accepted, inverse);
    assert.equal(undone.rows[grouped ? 0 : rowCount - 1][key], 'edit-8');
  }
  return { arm, setupMs, editMs, msPerEdit: editMs / edits, retainedHeapDelta, historyBytes, touchedRows,
    transportMs, payloadBytes, finalDigest, sourceHeap };
}
function warm(grouped) {
  // Warm both actual engines on a small source without adding a measured pair.
  const warmRows = clone(base.slice(0, 6));
  const warm = createEditor(clone(warmRows), columns); warm.edit(grouped ? 1 : 6, key, 'warm');
  const api = grouped ? groupApi : delta, s = api.createState({ ownerId: 'warm', clientGeneration: 1, rows: warmRows, customColumns: columns });
  if (grouped) api.applyGroupUnit(s, api.prepareGroupUnit(s, { kind: group.KIND, operationId: 'warm', action: 'cell-edit', rowId: 1, key, value: 'warm' }));
  else api.applyFieldCommand(s, api.prepareFieldCommand(s, { kind: delta.UNIT, operationId: 'warm', rowId: 6, writes: [{ key, after: { present: true, value: 'warm' } }] }));
}
if (process.argv[2] === '--measure-arm') {
  const grouped = process.argv[4] === 'group';
  warm(grouped);
  fs.writeSync(1, JSON.stringify(run(process.argv[3], grouped)));
  process.exit(0);
}
function isolatedRun(arm, grouped) {
  // A fresh process prevents delayed VM-context GC from contaminating the next
  // arm's retained heap. Startup and warmup remain outside the measured region.
  const result = spawnSync(process.execPath, ['--expose-gc', __filename, '--measure-arm', arm, grouped ? 'group' : 'independent'], { encoding: 'utf8', maxBuffer: 1024 * 1024 });
  if (result.status !== 0) throw new Error('Benchmark arm failed: ' + result.stderr);
  return JSON.parse(result.stdout);
}
const cases = [];
for (const grouped of [false, true]) {
  const pairs = [];
  for (let i = 0; i < 3; i++) {
    const order = i % 2 ? ['delta', 'legacy'] : ['legacy', 'delta'];
    const samples = order.map(arm => isolatedRun(arm, grouped));
    assert.equal(samples[0].finalDigest, samples[1].finalDigest);
    pairs.push({ pair: i + 1, order, samples });
  }
  const median = values => [...values].sort((a, b) => a - b)[1];
  cases.push({ name: grouped ? 'group-cell-edit-plus-history' : 'independent-cell-edit-plus-history', pairs,
    medianEditMs: Object.fromEntries(['legacy', 'delta'].map(arm => [arm, median(pairs.map(pair => pair.samples.find(sample => sample.arm === arm).editMs))])) });
}
const output = { recordedAt: new Date().toISOString(), environment: { node: process.version, platform: process.platform,
  arch: process.arch, cpu: os.cpus()[0].model, cpuCount: os.cpus().length, totalMemory: os.totalmem(), hostname: os.hostname() },
  baseCommit: pins.baseCommit, rowCount, editsPerArm: edits, baseBytes,
  lock: '/tmp/buyerlog-performance-measurement.lock', armIsolation: 'fresh Node process per arm; sequential on the same VM; spawn and warmup excluded', cases,
  scope: 'Module CPU/retained heap comparison only: actual editor dispatch + actual kolPushUndo/kolSnapshot, save:false, rerender:false, quotations:false. New arm prepare/apply with retained before/after inverse slots. No UI/storage/network/server timing; binding/certification setup and touched-row materialization reported separately. No application speedup claim. History bytes are JSON UTF-8 representation, not heap.' };
fs.writeFileSync(path.join(__dirname, 'evidence/micro.json'), JSON.stringify(output, null, 2) + '\n');
console.log(JSON.stringify({ rowCount, editsPerArm: edits, baseBytes, cases: cases.map(item => ({ name: item.name, medianEditMs: item.medianEditMs })) }, null, 2));

'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), vm = require('node:vm');
const { createRequire } = require('node:module');
const { createExcelWorkerClient } = require('../server/excel-worker-client');
const { extractFunction } = require('./helpers/app-main-functions');
const source = require('./helpers/server-source')();
const XLSX = require('xlsx');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fx-admission-'));
test.after(() => fs.rmSync(root, { recursive: true, force: true }));

function workbook(directory, value = 42) {
  fs.mkdirSync(directory, { recursive: true });
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
    [null, null, '2026-11'], [null, 'TRY', value], [null, 'EUR', .9], [null, 'GBP', .8],
  ]), 'Synthetic FX');
  XLSX.writeFile(wb, path.join(directory, 'KUR.xlsx'));
}
function harness(directory, runExcelTask = createExcelWorkerClient().runExcelTask) {
  let current = { _revision: 7, months: { '2026-10': { TRY: 40 }, '2026-11': { CHF: .8 } } };
  const calls = { saves: 0, publishes: 0, reads: 0, logs: [] };
  const context = {
    require: createRequire(path.join(__dirname, '../server/server.js')),
    __dirname: path.join(__dirname, '../server'), path, folderFxSyncStatus: null,
    sourceUserId: () => 'synthetic', sourceFolderForUser: () => directory,
    loadFx: () => structuredClone(current),
    saveFx(data, revision) {
      if (revision !== current._revision) throw Object.assign(new Error('REVISION_CONFLICT'), { code: 'REVISION_CONFLICT', statusCode: 409 });
      calls.saves++; current = { ...structuredClone(data), _revision: current._revision + 1 }; return current;
    },
    runExcelTask: (...args) => { calls.reads++; return runExcelTask(...args); },
    publishSharedMasterChange: () => calls.publishes++, logRuntimeFailure: (key, error) => calls.logs.push({ key, code: error.code }),
  };
  vm.createContext(context); vm.runInContext(extractFunction(source, 'syncFxFromKurWorkbook'), context);
  return { context, calls, current: () => structuredClone(current), setCurrent: value => { current = structuredClone(value); } };
}

test('real Excel admission BUSY drains, then the same workbook applies once on a normal attempt', async () => {
  const directory = path.join(root, 'busy'); workbook(directory);
  const client = createExcelWorkerClient({ maxWorkers: 1, maxPending: 1 });
  const active = client.runExcelTask('diagnosticSpin', { ms: 500 });
  const queued = client.runExcelTask('health');
  const h = harness(directory, client.runExcelTask), before = h.current();
  try {
    const result = await h.context.syncFxFromKurWorkbook('synthetic');
    assert.equal(result.reason, 'worker-busy');
    assert.equal(result.updated, false);
    assert.equal(h.context.folderFxSyncStatus.reason, 'worker-busy');
    assert.equal(h.context.folderFxSyncStatus.fingerprint, null);
    assert.deepEqual(h.current(), before);
    assert.equal(h.calls.saves, 0); assert.equal(h.calls.publishes, 0); assert.equal(h.calls.reads, 1);
    assert.equal(client.getExcelWorkerStats().rejected, 1);
  } finally { await Promise.all([active, queued]); }
  assert.equal(client.getExcelWorkerStats().activeWorkers, 0);
  const applied = await h.context.syncFxFromKurWorkbook('synthetic');
  assert.equal(applied.updated, true); assert.equal(h.context.folderFxSyncStatus, null);
  assert.equal(h.current().months['2026-11'].TRY, 42); assert.equal(h.current().months['2026-11'].CHF, .8);
  assert.equal(h.current().months['2026-10'].TRY, 40);
  assert.match(h.current().sourceFingerprint, /^[a-f0-9]{64}$/);
  assert.equal(h.current()._revision, before._revision + 1);
  assert.equal((await h.context.syncFxFromKurWorkbook('synthetic')).updated, false);
  assert.equal((await h.context.syncFxFromKurWorkbook('synthetic', true)).reason, 'unchanged');
  assert.equal(h.calls.saves, 1); assert.equal(h.calls.publishes, 1);
});

test('missing, corrupt and valid workbooks remain distinct and preserve rates until valid', async () => {
  const directory = path.join(root, 'files'); fs.mkdirSync(directory);
  const h = harness(directory), before = h.current();
  const missing = await h.context.syncFxFromKurWorkbook('synthetic');
  assert.equal(missing.found, false); assert.notEqual(missing.reason, 'parse-failed');
  assert.equal(h.context.folderFxSyncStatus, null);
  fs.writeFileSync(path.join(directory, 'KUR.xlsx'), 'synthetic invalid workbook');
  const corrupt = await h.context.syncFxFromKurWorkbook('synthetic');
  assert.equal(corrupt.found, true); assert.equal(corrupt.reason, 'parse-failed');
  assert.equal(h.context.folderFxSyncStatus.reason, 'parse-failed');
  assert.deepEqual(h.current(), before); assert.equal(h.calls.saves, 0);
  workbook(directory);
  assert.equal((await h.context.syncFxFromKurWorkbook('synthetic')).updated, true);
  assert.equal(h.context.folderFxSyncStatus, null); assert.equal(h.calls.saves, 1);
});

test('timeout, cancellation and worker failure are sync failures, never corrupt-file recovery', async () => {
  for (const code of ['EXCEL_WORKER_TIMEOUT', 'REFRESH_CANCELLED', 'EXCEL_WORKER_ERROR']) {
    const h = harness(root, async () => { throw Object.assign(new Error(code), { code }); });
    const before = h.current(), result = await h.context.syncFxFromKurWorkbook('synthetic');
    assert.equal(result.reason, 'sync-failed'); assert.equal(result.updated, false);
    assert.equal(h.context.folderFxSyncStatus.reason, 'sync-failed');
    assert.deepEqual(h.current(), before); assert.equal(h.calls.saves, 0); assert.equal(h.calls.reads, 1);
  }
});

test('an unchanged normal read clears stale BUSY status without writing', async () => {
  let busy = true;
  const h = harness(root, async () => {
    if (busy) throw Object.assign(new Error('busy'), { code: 'EXCEL_WORKER_BUSY' });
    return { found: true, updated: false, file: 'KUR.xlsx' };
  });
  await h.context.syncFxFromKurWorkbook('synthetic'); busy = false;
  await h.context.syncFxFromKurWorkbook('synthetic');
  assert.equal(h.context.folderFxSyncStatus, null); assert.equal(h.calls.saves, 0);
});

test('explicit confirmation keeps BUSY rejection, fingerprint and revision conflicts', async () => {
  const directory = path.join(root, 'explicit'); workbook(directory);
  const client = createExcelWorkerClient(); let busy = true;
  const h = harness(directory, (...args) => {
    if (busy) throw Object.assign(new Error('busy'), { code: 'EXCEL_WORKER_BUSY', statusCode: 503 });
    return client.runExcelTask(...args);
  });
  const fingerprint = require('../server/lib/fxWorkbook').readFxWorkbook(path.join(directory, 'KUR.xlsx')).data.sourceFingerprint;
  const explicit = { fingerprint, expectedRevision: 7 };
  await assert.rejects(h.context.syncFxFromKurWorkbook('synthetic', true, explicit), { code: 'EXCEL_WORKER_BUSY', statusCode: 503 });
  assert.equal(h.context.folderFxSyncStatus.reason, 'worker-busy'); assert.equal(h.calls.saves, 0);
  busy = false;
  h.setCurrent({ _revision: 8, reportMonth: '2026-12', sourceType: 'UPLOAD', months: { '2026-12': { TRY: 50 } } });
  await assert.rejects(h.context.syncFxFromKurWorkbook('synthetic', true, explicit), { code: 'REVISION_CONFLICT' });
  await assert.rejects(h.context.syncFxFromKurWorkbook('synthetic', true, { ...explicit, fingerprint: '0'.repeat(64), expectedRevision: 8 }), { code: 'SOURCE_KUR_CHANGED' });
  assert.equal(h.calls.saves, 0);
  assert.equal((await h.context.syncFxFromKurWorkbook('synthetic')).reason, 'older-report');
  assert.equal((await h.context.syncFxFromKurWorkbook('synthetic', true, { ...explicit, expectedRevision: 8 })).updated, true);
  assert.equal(h.calls.saves, 1); assert.equal(h.current().months['2026-12'].TRY, 50);
});

function uiHarness() {
  const element = () => ({ hidden: false, children: [], textContent: '',
    append(...nodes) { this.children.push(...nodes); }, replaceChildren() { this.children = []; } });
  const requests = [], toasts = [];
  const context = { appLang: 'tr', console, document: { createElement: element },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    window: { addEventListener() {}, showToast: message => toasts.push(message), confirm: () => false },
    fetch: async (...args) => { requests.push(args); throw new Error('Unexpected fetch'); },
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../public/fx.js'), 'utf8'), context);
  return { context, fx: context.window.BLFX, host: element(), requests, toasts };
}
test('TR/EN status separates BUSY, infrastructure failure and corrupt-file AI recovery', async () => {
  const h = uiHarness();
  for (const [lang, busyText, failedText, aiText] of [
    ['tr', /kuyruğu dolu/, /güncellemesi tamamlanamadı/, 'LCW AI ile oku'],
    ['en', /queue is full/, /could not be completed/, 'Read with LCW AI'],
  ]) {
    h.context.appLang = lang;
    for (const [reason, text] of [['worker-busy', busyText], ['sync-failed', failedText]]) {
      h.fx.store.folderSync = { reason }; h.fx.renderFolderSync(h.host);
      assert.match(h.host.children[0].textContent, text);
      assert.equal(h.host.children.length, 1, 'only status text; no repair or force-apply action');
      assert.equal(await h.fx.openFolderRecovery(), false);
    }
    h.fx.store.folderSync = { reason: 'parse-failed' }; h.fx.renderFolderSync(h.host);
    assert.equal(h.host.children.at(-1).textContent, aiText);
    h.fx.store.folderSync = null; h.fx.renderFolderSync(h.host); assert.equal(h.host.hidden, true);
  }
  assert.equal(h.requests.length, 0);
});
test('explicit UI application requires confirmation and refreshes BUSY without claiming file conflict', async () => {
  const h = uiHarness();
  h.fx.store.folderSync = { reason: 'older-report', fingerprint: 'a'.repeat(64) }; h.fx.store._revision = 7;
  assert.equal(await h.fx.applySourceKur(), false); assert.equal(h.requests.length, 0);
  h.context.window.confirm = () => true;
  h.context.fetch = async (url, options) => {
    h.requests.push({ url, options });
    return url.endsWith('apply-source-kur')
      ? { ok: false, status: 503, json: async () => ({ code: 'EXCEL_WORKER_BUSY' }) }
      : { ok: true, json: async () => ({ _revision: 7, months: { '2026-10': { TRY: 40 } }, folderSync: { reason: 'worker-busy' } }) };
  };
  h.fx.renderFolderSync(h.host); await h.host.children.at(-1).onclick();
  assert.match(h.toasts[0], /kuyruğu dolu/);
  assert.match(h.host.children[0].textContent, /kuyruğu dolu/); assert.equal(h.host.children.length, 1);
  assert.equal(h.fx.store._revision, 7); assert.equal(h.fx.store.months['2026-10'].TRY, 40);
  assert.equal(h.requests.length, 2);
  assert.deepEqual(JSON.parse(h.requests[0].options.body), { fingerprint: 'a'.repeat(64), expectedRevision: 7 });
});

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const APP_PATH = path.join(__dirname, '..', 'public', 'app-main.js');
const SERVER_PATH = path.join(__dirname, '..', 'server', 'server.js');
const APP = fs.readFileSync(APP_PATH, 'utf8');
const SERVER = fs.readFileSync(SERVER_PATH, 'utf8');

function extractFunction(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `Missing function ${name}`);
  let parenDepth = 0;
  let bodyOpen = -1;
  for (let i = source.indexOf('(', start); i < source.length; i += 1) {
    if (source[i] === '(') parenDepth += 1;
    else if (source[i] === ')') {
      parenDepth -= 1;
      if (parenDepth === 0) {
        bodyOpen = source.indexOf('{', i);
        break;
      }
    }
  }
  assert.ok(bodyOpen > start, `Missing body for ${name}`);
  let depth = 0;
  let inSingle = false;
  let inDouble = false;
  let inTemplate = false;
  let inLineComment = false;
  let inBlockComment = false;
  let escaped = false;
  for (let i = bodyOpen; i < source.length; i += 1) {
    const ch = source[i];
    const next = source[i + 1];
    if (inLineComment) { if (ch === '\n') inLineComment = false; continue; }
    if (inBlockComment) { if (ch === '*' && next === '/') { inBlockComment = false; i += 1; } continue; }
    if (escaped) { escaped = false; continue; }
    if (ch === '\\') { escaped = true; continue; }
    if (inSingle) { if (ch === "'") inSingle = false; continue; }
    if (inDouble) { if (ch === '"') inDouble = false; continue; }
    if (inTemplate) { if (ch === '`') inTemplate = false; continue; }
    if (ch === '/' && next === '/') { inLineComment = true; i += 1; continue; }
    if (ch === '/' && next === '*') { inBlockComment = true; i += 1; continue; }
    if (ch === "'") { inSingle = true; continue; }
    if (ch === '"') { inDouble = true; continue; }
    if (ch === '`') { inTemplate = true; continue; }
    if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  throw new Error(`Unclosed function ${name}`);
}

test('A1 · applyIncrementalProjectionPatch kural kaynaklı Supp. FOB bilgisini korur, manuel yamayı manuel bırakır', () => {
  const parseLib = require('../server/lib/parse');
  const ctx = { parseLib, Object, Number, String, Set };
  vm.createContext(ctx);
  vm.runInContext(extractFunction(SERVER, 'applyIncrementalProjectionPatch'), ctx);

  const ruleRow = { 'Order Code': 4100001, 'Supp. FOB': 5.0 };
  ctx.applyIncrementalProjectionPatch(
    ruleRow,
    { suppFob: 7.25, suppFobMeta: { source: 'rule', ruleId: 'rule-42' } },
    {},
    false,
  );
  assert.equal(ruleRow['Supp. FOB'], 7.25);
  assert.equal(ruleRow._suppFobOverride, true);
  assert.equal(ruleRow._suppFobManual, false, 'kural kaynaklı Supp. FOB önbellekte manuel işaretlenmemeli');
  assert.equal(ruleRow._suppFobRule, 'rule-42');
  assert.equal(ruleRow._suppFobMeta.source, 'rule');

  const manualRow = { 'Order Code': 4100002, 'Supp. FOB': 5.0, _suppFobRule: 'rule-42' };
  ctx.applyIncrementalProjectionPatch(
    manualRow,
    { suppFob: 8.1, suppFobMeta: { source: 'manual' } },
    {},
    false,
  );
  assert.equal(manualRow['Supp. FOB'], 8.1);
  assert.equal(manualRow._suppFobOverride, true);
  assert.equal(manualRow._suppFobManual, true);
  assert.equal(manualRow._suppFobRule, null);
  assert.equal(manualRow._suppFobMeta.source, 'manual');
});

test('A2 · applyRemoteRowPatch noteColumns alanlarını uygular ve delType/Ex-factory değişiminde lojistik segmentini applyFormulas öncesinde günceller', () => {
  const callOrder = [];
  const ctx = {
    CP_IMAGE_API: '/api/cp-images',
    CP_NOTE_COLUMN_DEFS: [{ id: 'note_col_1' }, { id: 'note_col_2' }],
    BLImageRuntime: { invalidate() {} },
    window: {},
    recalcSuppFobForRow: () => {},
    syncCpProductionLogisticSegment: (_r, del) => {
      callOrder.push(del !== undefined ? `logistic:del:${del}` : 'logistic:ex');
      return false;
    },
    applyFormulas: () => { callOrder.push('applyFormulas'); },
    invalidateUnifiedPriorityDecisions: () => {},
    scheduleOverviewRender: () => {},
    Object, Number, String, Set, Array, encodeURIComponent,
  };
  vm.createContext(ctx);
  vm.runInContext(extractFunction(APP, 'applyRemoteRowPatch'), ctx);

  const row = { 'Order Code': 4100001, 'Del. Type': 'Gemi', note_col_1: 'Eski', note_col_2: 'Kalmalı' };
  ctx.applyRemoteRowPatch(row, {
    delType: 'Uçak',
    noteColumns: { note_col_1: 'Yeni Not', note_col_2: null, invalid_col: 'Yoksay' },
  });
  assert.equal(row['Del. Type'], 'Uçak');
  assert.equal(row.note_col_1, 'Yeni Not');
  assert.equal(row.note_col_2, '');
  assert.equal(row.invalid_col, undefined);
  assert.deepEqual(JSON.parse(JSON.stringify(callOrder)), ['logistic:del:Uçak', 'applyFormulas']);

  callOrder.length = 0;
  ctx.applyRemoteRowPatch(row, { dates: { exFactory: '2026-09-10' } });
  assert.equal(row['Ex-factory'], '2026-09-10');
  assert.deepEqual(JSON.parse(JSON.stringify(callOrder)), ['logistic:ex', 'applyFormulas']);
});

test('A3 · saveDateOverrides yalnız dokunulan tarih alanlarını gönderir, ardışık debounce çağrılarını birleştirir ve touchedKeys verilmezse üç alanı korur', () => {
  const timers = new Map();
  let seq = 0;
  const sent = [];
  const row = {
    'Order Code': 4100010,
    'Model Name': 'MDL-1',
    'C.Code': 'C1',
    'Ex-factory': new Date(2026, 7, 15),
    'Retail Date': new Date(2026, 9, 1),
    'In-Store (Model Budget)': new Date(2026, 8, 17),
  };
  let revisedSet = new Set(['Ex-factory']);
  const ctx = {
    window: { SERVER_BACKED: true },
    state: { overrides: { datemap: { '4100010|MDL-1|C1': { retail: '2026-10-01', mb: '2026-09-17' } } } },
    BLRevision: { revisedDateKeys: () => [...revisedSet] },
    overrideSyncKey: (r, oc) => `${oc}|${r['Model Name']}|${r['C.Code']}`,
    lineIdentity: r => ({ modelName: r['Model Name'], ccode: r['C.Code'] }),
    toISODate: d => (d instanceof Date ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` : ''),
    enqueueOverrideMutation: (_area, url, opts) => {
      sent.push({ url, body: JSON.parse(opts.body) });
      return Promise.resolve({ ok: true });
    },
    notifyOverrideSaveError: () => {},
    appLang: 'tr',
    setTimeout: fn => { const id = ++seq; timers.set(id, fn); return id; },
    clearTimeout: id => { timers.delete(id); },
    console: { warn() {} },
    Map, Set, Object, Array, String, JSON,
  };
  vm.createContext(ctx);
  vm.runInContext(`
    const _pendingOverrideWrites = new Map();
    const _pendingDateOverrideKeys = new Map();
    ${extractFunction(APP, 'schedulePendingOverrideWrite')}
    ${extractFunction(APP, 'flushPendingOverrideWrites')}
    ${extractFunction(APP, 'saveDateOverrides')}
  `, ctx);

  // 1) Tek alan: yalnız exFactory gönderilir; dokunulmayan retail/inStore payload'da yer almaz.
  ctx.saveDateOverrides(row, ['Ex-factory']);
  ctx.flushPendingOverrideWrites();
  assert.equal(sent.length, 1);
  assert.deepEqual(sent[0].body.dates, { exFactory: '2026-08-15' });
  assert.deepEqual(
    JSON.parse(JSON.stringify(ctx.state.overrides.datemap['4100010|MDL-1|C1'])),
    { ex: '2026-08-15', retail: '2026-10-01', mb: '2026-09-17' },
  );

  // 2) Debounce içinde ardışık çağrılar birleşir ve revizyonu kaldırılan alan null gider.
  sent.length = 0;
  revisedSet = new Set(['Retail Date', 'In-Store (Model Budget)']); // Ex-factory orijinaline döndü
  ctx.saveDateOverrides(row, ['Ex-factory']);
  ctx.saveDateOverrides(row, ['Retail Date', 'In-Store (Model Budget)']);
  ctx.flushPendingOverrideWrites();
  assert.equal(sent.length, 1);
  assert.deepEqual(sent[0].body.dates, {
    exFactory: null,
    retailDate: '2026-10-01',
    inStoreDate: '2026-09-17',
  });
  assert.deepEqual(
    JSON.parse(JSON.stringify(ctx.state.overrides.datemap['4100010|MDL-1|C1'])),
    { retail: '2026-10-01', mb: '2026-09-17' },
  );

  // 3) touchedKeys verilmezse eski davranış (üç alan) korunur.
  sent.length = 0;
  revisedSet = new Set();
  ctx.saveDateOverrides(row);
  ctx.flushPendingOverrideWrites();
  assert.equal(sent.length, 1);
  assert.deepEqual(sent[0].body.dates, {
    exFactory: null,
    retailDate: null,
    inStoreDate: null,
  });

  // commitCpEditor kaynak sözleşmesi: exfactory ve retail/instore dalları doğru anahtarları geçirir.
  const commitSrc = extractFunction(APP, 'commitCpEditor');
  assert.match(commitSrc, /saveDateOverrides\(row,\s*\['Ex-factory'\]\)/);
  assert.match(commitSrc, /saveDateOverrides\(row,\s*\['Retail Date',\s*'In-Store \(Model Budget\)'\]\)/);
});

test('A4 · applyHistoryAction tarih geri/ileri alma işlemlerinde saveDateOverrides çağırır', () => {
  const savedCalls = [];
  const cpRow = {
    _id: 1,
    'Order Code': 4100010,
    'Ex-factory': new Date(2026, 7, 20),
    'Retail Date': new Date(2026, 9, 10),
    'In-Store (Model Budget)': new Date(2026, 8, 26),
    'Del. Type': 'Gemi',
  };
  const ctx = {
    state: { cp: { rows: [cpRow] } },
    shipRows: [],
    syncCpProductionLogisticSegment: () => false,
    applyFormulas: () => {},
    saveDateOverrides: (row, keys) => { savedCalls.push({ orderCode: row['Order Code'], keys: [...keys] }); },
    invalidateUnifiedPriorityDecisions: () => {},
    markDirty: () => {},
    refreshRowEverywhere: () => {},
    refreshSubmfrList: () => {},
    refreshLicensorList: () => {},
    Set, Array,
  };
  vm.createContext(ctx);
  vm.runInContext(extractFunction(APP, 'applyHistoryAction'), ctx);

  const prevEx = new Date(2026, 7, 10);
  const nextEx = new Date(2026, 7, 20);
  ctx.applyHistoryAction({ id: 1, fields: [{ key: 'Ex-factory', prev: prevEx, next: nextEx }] }, 'undo');
  assert.equal(cpRow['Ex-factory'].getDate(), 10);
  assert.deepEqual(JSON.parse(JSON.stringify(savedCalls)), [{ orderCode: 4100010, keys: ['Ex-factory'] }]);
});

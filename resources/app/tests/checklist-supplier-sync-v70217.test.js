'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const childProcess = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const SYNC = require('../public/checklist-supplier-sync.js');

test('checklist supplier bridge normalizes supplier statuses and answer deltas deterministically', () => {
  // v7.221: Pending · Approved · Rejected · Not Required. Eski Excel değerleri
  // (Completed / Tamamlandı / Open) aynı kanonik duruma okunur.
  assert.equal(SYNC.normalizeState('Tamamlandı'), 'approved');
  assert.equal(SYNC.normalizeState('Completed'), 'approved');
  assert.equal(SYNC.normalizeState('Approved'), 'approved');
  assert.equal(SYNC.normalizeState('Reddedildi'), 'rejected');
  assert.equal(SYNC.normalizeState('Rejected'), 'rejected');
  assert.equal(SYNC.normalizeState('Gerekmiyor'), 'notRequired');
  assert.equal(SYNC.normalizeState('Not Required'), 'notRequired');
  assert.equal(SYNC.normalizeState('Pending'), 'open');
  assert.equal(SYNC.normalizeState('Open'), 'open');
  assert.equal(SYNC.normalizeState('bilinmeyen'), '');

  const before = {
    'order-1::fabric-test': { state: 'done', at: '2026-10-03T10:00:00.000Z', loadDate: '2026-10-20' },
  };
  const after = {
    'order-2::fabric-test': { state: 'notRequired', at: '2026-10-03T11:00:00.000Z', loadDate: '2026-10-21' },
  };
  const diff = SYNC.diffAnswers(before, after);
  assert.equal(diff.length, 2);
  assert.ok(diff.some(item => item.orderKey === 'order-1' && item.itemId === 'fabric-test' && item.state === 'open'));
  assert.ok(diff.some(item => item.orderKey === 'order-2' && item.itemId === 'fabric-test' && item.state === 'notRequired'));
  assert.match(SYNC.columnKey('fabric test / lab'), /^__checklist__/);
});

test('checklist Excel dates normalize to one native Excel date shape', () => {
  const iso = SYNC.excelDate('2026-10-19');
  const compact = SYNC.excelDate('20261019');
  const local = SYNC.excelDate('19.10.2026');
  const timestamp = SYNC.excelDate('2026-10-19T12:35:00');
  for (const value of [iso, compact, local, timestamp]) {
    assert.ok(value instanceof Date);
    assert.equal(value.getFullYear(), 2026);
    assert.equal(value.getMonth(), 9);
    assert.equal(value.getDate(), 19);
  }
});

test('shared checklist store rejects stale supplier Excel and preserves newer Buyer Log answers', () => {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bl-checklist-supplier-'));
  try {
    const storePath = path.join(ROOT, 'server', 'lib', 'checklist-supplier-store.js');
    const script = [
      "const store=require(" + JSON.stringify(storePath) + ");",
      "const actor={id:'buyer-1',displayName:'Buyer One'};",
      "const first=store.applyEntries([{orderKey:'O1',itemId:'fabric-test',state:'done',at:'2026-10-03T10:00:00.000Z',loadDate:'2026-10-20'}],actor,{source:'buyer_log'});",
      "const stale=store.applyEntries([{orderKey:'O1',itemId:'fabric-test',state:'open',at:'2026-10-03T11:00:00.000Z',baseAt:'2026-10-03T09:00:00.000Z'}],actor,{source:'supplier_excel'});",
      "const fresh=store.applyEntries([{orderKey:'O1',itemId:'fabric-test',state:'notRequired',at:'2026-10-03T12:00:00.000Z',baseAt:'2026-10-03T10:00:00.000Z'}],actor,{source:'supplier_excel'});",
      "const opened=store.applyEntries([{orderKey:'O1',itemId:'fabric-test',state:'open',at:'2026-10-03T13:00:00.000Z',baseAt:'2026-10-03T12:00:00.000Z'}],actor,{source:'supplier_excel'});",
      "const def=store.replaceDefinitions([{id:'fabric-test',kind:'checklist',name:'Fabric Test',tr:'Fabric Test',en:'Fabric Test',questionTr:'Fabric Test tamam mı?',questionEn:'Is Fabric Test complete?',conditions:[]}],actor);",
      "process.stdout.write(JSON.stringify({first,stale,fresh,opened,payload:store.publicPayload(),def}));",
    ].join('');
    const raw = childProcess.execFileSync(process.execPath, ['-e', script], {
      encoding: 'utf8',
      env: { ...process.env, BUYER_LOG_SERVER_DATA_ROOT: dataRoot, BUYER_LOG_LOCAL_DATA_ROOT: path.join(dataRoot, 'local') },
    });
    const result = JSON.parse(raw);
    assert.equal(result.first.updated, 1);
    assert.equal(result.stale.conflicts, 1);
    assert.equal(result.fresh.updated, 1);
    assert.equal(result.opened.cleared, 1);
    assert.equal(Object.keys(result.payload.answers).length, 0);
    assert.equal(result.payload.tombstones['O1::fabric-test'].state, 'open');
    assert.equal(result.def.definitions[0].id, 'fabric-test');
  } finally {
    fs.rmSync(dataRoot, { recursive: true, force: true });
  }
});

test('wiring loads the bridge after app-main and registers shared checklist routes', () => {
  const index = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');
  const server = fs.readFileSync(path.join(ROOT, 'server', 'server.js'), 'utf8');
  const bridge = fs.readFileSync(path.join(ROOT, 'public', 'checklist-supplier-sync.js'), 'utf8');
  const routes = fs.readFileSync(path.join(ROOT, 'server', 'routes', 'checklist-supplier-routes.js'), 'utf8');

  assert.ok(index.indexOf('app-main.js') < index.indexOf('checklist-supplier-sync.js'));
  assert.match(server, /require\('\.\/routes\/checklist-supplier-routes'\)\(app/);
  assert.match(routes, /\/api\/checklist-supplier\/answers/);
  assert.match(routes, /\/api\/checklist-supplier\/definitions/);
  assert.match(bridge, /group:\s*'Checklist'/);
  assert.match(bridge, /__BL_ORDER_KEY/);
  assert.match(bridge, /dataValidation/);
  assert.match(bridge, /baseAt:\s*meta\.exportedAt/);
  assert.match(bridge, /activeNeedsRuntime/);

  // Tools -> Checklist tek giriş noktası; eski iki ayrı Tools butonu yok.
  assert.match(bridge, /id = 'cpChecklistToolsBtn'/);
  assert.match(bridge, /Create Checklist Excel/);
  assert.match(bridge, /Import Checklist Excel/);
  assert.match(bridge, /Checklist Excel Columns/);
  assert.doesNotMatch(bridge, /cpSupplierChecklistExportBtn|cpSupplierChecklistImportBtn/);

  // Workbook kompakt, görselli ve yanlışlıkla düzenlemeye kapalıdır.
  assert.match(bridge, /Model Görseli/);
  assert.match(bridge, /canonicalModelImageSource/);
  assert.match(bridge, /kolPrepareExcelImage/);
  assert.match(bridge, /excelRow\.height = imageColumn \? 38 : 22/);
  assert.match(bridge, /width: 14, checklistStatus: true/);
  assert.match(bridge, /width: 22, checklistNote: true/);
  assert.match(bridge, /protection = \{ locked: true \}/);
  assert.match(bridge, /statusCell\.protection = \{ locked: !applicable \|\| derived \}/);
  assert.match(bridge, /noteCell\.protection = \{ locked: !applicable \}/);
  assert.match(bridge, /sheet\.protect\(EXCEL_PROTECTION_PASSWORD/);

  // Backlog V3 ile aynı renk ailesinde, dosya değiştikçe hesaplanan özet ekranı vardır.
  assert.match(bridge, /CHECKLIST_EXCEL_COLORS/);
  assert.match(bridge, /Checklist Özet/);
  assert.match(bridge, /renderChecklistSummary/);
  assert.match(bridge, /statusCountFormula/);
  assert.match(bridge, /fullCalcOnLoad:\s*true/);
  assert.match(bridge, /applyChecklistConditionalFormatting/);
  assert.match(bridge, /Checklist Status Distribution/);
  assert.match(bridge, /Dosya düzenlendikçe yenilenir/);

  // Ex-Factory gerçek Excel Date olur; tek format ve date validation kullanır.
  assert.match(bridge, /EXCEL_DATE_FORMAT = 'dd\.mm\.yyyy'/);
  assert.match(bridge, /cell\.numFmt = EXCEL_DATE_FORMAT/);
  assert.match(bridge, /type: 'date', operator: 'between'/);
  assert.match(bridge, /\^\\d\{4\}-\\d\{2\}-\\d\{2\}\[T \]\\d\{2\}:\\d\{2\}/);
  assert.match(bridge, /dataUrlPreparedImage/);
});

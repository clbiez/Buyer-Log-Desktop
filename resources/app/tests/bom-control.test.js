'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const E = require('../public/bom-control-engine.js');
const bomStore = require('../server/lib/plm-bom-store');

const fabric = code => ({ componentCode: code, componentName: 'Single Jersey', mainCategoryName: 'Fabric', categoryGroupName: 'Knit', categoryName: 'Main Fabric', quantity: 0.35 });
const label = code => ({ componentCode: code, componentName: 'Brand Label', mainCategoryName: 'Trims', categoryGroupName: 'Label', categoryName: 'Woven Label', quantity: 1 });
const print = code => ({ componentCode: code, componentName: 'Front Print', mainCategoryName: 'Embellishment', categoryGroupName: 'Artwork', categoryName: 'Print', quantity: 1 });
const model = (plmId, components) => ({ plmId, label: 'M' + plmId, hasBom: true, components });

function group(count, build) {
  return Array.from({ length: count }, (_, i) => model(String(1000 + i), build(i)));
}

test('stale label code copied from a previous season is flagged in an otherwise common slot', () => {
  const models = group(30, i => [fabric('FAB-1'), label(i === 7 ? 'LBL-S6-OLD' : 'LBL-NEW'), print('PR-' + i)]);
  const result = E.analyze(models, { slotLevel: 'category' });
  const labelSlot = result.slots.find(slot => slot.label.includes('Woven Label'));
  assert.equal(labelSlot.mode, 'auto-common');
  assert.equal(labelSlot.findings.length, 1);
  assert.deepEqual(labelSlot.findings[0], { plmId: '1007', kind: 'different', missing: ['LBL-NEW'], extra: ['LBL-S6-OLD'], severity: 'warning' });
  // Model bazlı farklı baskı kodları sapma üretmez.
  const printSlot = result.slots.find(slot => slot.label.includes('Print'));
  assert.equal(printSlot.mode, 'auto-model');
  assert.equal(printSlot.findings.length, 0);
  assert.equal(result.summary.flaggedModels, 1);
});

test('user marks override auto mode: common gives errors, model silences the slot', () => {
  const models = group(10, i => [fabric(i < 8 ? 'FAB-1' : 'FAB-X'), print('PR-' + i)]);
  const fabricKey = E.slotOf(fabric('x'), 'category').markKey;
  const printKey = E.slotOf(print('x'), 'category').markKey;
  const marked = E.analyze(models, { slotLevel: 'category', marks: { [fabricKey]: 'common', [printKey]: 'model' } });
  const fabricSlot = marked.slots.find(slot => slot.markKey === fabricKey);
  assert.equal(fabricSlot.mode, 'common');
  assert.deepEqual(fabricSlot.findings.map(item => [item.plmId, item.severity]), [['1008', 'error'], ['1009', 'error']]);
  assert.equal(marked.slots.find(slot => slot.markKey === printKey).mode, 'model');
  assert.equal(marked.summary.errors, 2);

  const silenced = E.analyze(models, { slotLevel: 'category', marks: { [fabricKey]: 'model' } });
  assert.equal(silenced.slots.find(slot => slot.markKey === fabricKey).findings.length, 0);
});

test('missing common item and scattered common slot are reported', () => {
  const models = group(5, i => (i === 4 ? [print('P')] : [label('L1'), print('P')]));
  const result = E.analyze(models, { slotLevel: 'group' });
  const slot = result.slots.find(item => item.label === 'Trims › Label');
  assert.deepEqual(slot.findings.map(item => [item.plmId, item.kind]), [['1004', 'absent']]);

  const scatter = group(4, i => [fabric('F' + i)]);
  const key = E.slotOf(fabric('x'), 'category').markKey;
  const scattered = E.analyze(scatter, { marks: { [key]: 'common' } });
  assert.equal(scattered.slots[0].mode, 'scattered');
  assert.equal(scattered.summary.scatteredSlots, 1);
});

test('models without full BOM are excluded from comparison and listed', () => {
  const models = [...group(4, () => [label('L1')]), { plmId: '9', label: 'X', hasBom: false, components: [] }];
  const result = E.analyze(models, {});
  assert.equal(result.bomModelCount, 4);
  assert.deepEqual(result.noBom, ['9']);
  assert.equal(result.slots[0].findings.length, 0);
});

test('set style parts compare separately but share the same mark key', () => {
  const a = E.slotOf({ ...fabric('F'), setPart: 'A' }, 'category');
  const b = E.slotOf({ ...fabric('F'), setPart: 'B' }, 'category');
  assert.notEqual(a.key, b.key);
  assert.equal(a.markKey, b.markKey);
  assert.equal(E.slotOf(fabric('F'), 'main').markKey, 'main:fabric');
});

test('rows collapse to one model per PLM ID and build a multi-level breakdown tree', () => {
  const rows = [
    { 'PLM ID': '1', 'Model Name': 'Tee', Category: 'T-Shirt', License: 'Disney', Colour: 'Red' },
    { 'PLM ID': '1', 'Model Name': 'Tee', Category: 'T-Shirt', License: 'Disney', Colour: 'Blue' },
    { 'PLM ID': '2', 'Model Name': 'Tee 2', Category: 'T-Shirt', License: 'Marvel' },
    { 'PLM ID': '3', 'Model Name': 'Sweat', Category: 'Sweatshirt', License: '' },
    { 'PLM ID': '', 'Model Name': 'No PLM' },
  ];
  const models = E.modelsFromRows(rows, { fields: ['Category', 'License', 'Colour'] });
  assert.equal(models.length, 3);
  assert.equal(models[0].rowCount, 2);
  assert.equal(models[0].dims.Colour, 'Blue / Red');
  const { root, byId } = E.buildTree(models, ['Category', 'License']);
  assert.equal(root.models.length, 3);
  assert.deepEqual(root.children.map(node => node.value), ['Sweatshirt', 'T-Shirt']);
  const tshirt = byId.get(JSON.stringify(['T-Shirt']));
  assert.deepEqual(tshirt.children.map(node => node.value), ['Disney', 'Marvel']);
  const blank = byId.get(JSON.stringify(['Sweatshirt'])).children[0];
  assert.equal(blank.value, '');
});

test('one aggregate is re-evaluated per mark change without re-aggregating', () => {
  const models = group(6, i => [fabric(i === 5 ? 'FAB-X' : 'FAB-1')]);
  const agg = E.aggregate(models, 'category');
  const key = E.slotOf(fabric('x'), 'category').markKey;
  assert.equal(E.evaluate(agg, {}).slots[0].mode, 'auto-common');
  assert.equal(E.evaluate(agg, { marks: { [key]: 'common' } }).summary.errors, 1);
  assert.equal(E.evaluate(agg, { marks: { [key]: 'model' } }).summary.errors, 0);
  assert.deepEqual(E.analyze(models, { marks: { [key]: 'common' } }).summary, E.evaluate(agg, { marks: { [key]: 'common' } }).summary);
});

test('mark normalization drops unknown values', () => {
  assert.deepEqual(E.normalizeMarks({ a: 'common', b: 'model', c: 'other', '': 'common' }), { a: 'common', b: 'model' });
});

test('controlEntry exposes full components and flags decoration-only legacy records', () => {
  const full = bomStore.controlEntry({ plmId: '5', fullComponents: [label('L1')], components: [], fetchedAt: 'x' });
  assert.equal(full.coverage, 'full');
  assert.equal(full.components[0].componentCode, 'L1');
  assert.equal(full.components[0].quantity, 1);
  const legacy = bomStore.controlEntry({ plmId: '6', components: [print('P')] });
  assert.equal(legacy.coverage, 'decorations-only');
  assert.equal(bomStore.controlEntry(null), null);
});

test('BOM Check is wired lazily into CP tools with CP-only access and synced personal marks', () => {
  const routes = read('server/routes/plm-sync-routes.js');
  assert.match(routes, /app\.post\('\/api\/plm-sync\/bom\/control', userAccess\.requireAnyArea\('cp'\)/);
  const perf = read('public/perf-runtime.js');
  assert.match(perf, /bomControl:\['bom-control-engine\.js\?rev=1','bom-control\.js\?rev=1'\]/);
  assert.match(perf, /bomControl:\['bom-control\.css'\]/);
  const html = read('public/index.html');
  assert.match(html, /id="cpBomControlBtn"[^>]*data-i18n-title-en=/);
  assert.match(html, /data-i18n-tr="BOM Kontrol" data-i18n-en="BOM Check"/);
  assert.doesNotMatch(html, /<script src="bom-control/);
  const main = read('public/app-main.js');
  assert.match(main, /getElementById\('cpBomControlBtn'\)[\s\S]{0,1400}ensureFeature\('bomControl'\)/);
  assert.match(read('public/user-storage.js'), /'lcw\.cp\.bomControl\.'[\s\S]*'lcw\.cp\.bomControl\.'/);
  assert.match(read('server/lib/user-preferences.js'), /'lcw\.cp\.bomControl\.'/);
  const ui = read('public/bom-control.js');
  assert.match(ui, /PREF_KEY = 'lcw\.cp\.bomControl\.v1'/);
  assert.match(ui, /BLMotionPlus\.play\('overlay'/);
  assert.match(ui, /bindDialogKeyboard/);
  assert.deepEqual([...ui.matchAll(/fetch\('([^']+)'/g)].map(m => m[1]), ['/api/plm-sync/bom/control']);
  assert.doesNotMatch(ui, /BuyerLogAI|\/api\/lcwai/);
});

test('right-click BOM detail lists all stored BOM items with read-only BOM Check marks', () => {
  const ui = read('public/plm-bom.js');
  assert.match(ui, /void renderFullBom\(body, entry\)/);
  assert.match(ui, /BOM_CONTROL_PREF_KEY = 'lcw\.cp\.bomControl\.v1'/);
  // Motor perf-runtime 'bomControl' özelliğiyle aynı dizeyle yüklenir (tek kez).
  assert.match(ui, /_loadScript\?\.\('bom-control-engine\.js\?rev=1'\)/);
  assert.match(read('public/perf-runtime.js'), /'bom-control-engine\.js\?rev=1'/);
  // Pencere işaret yazmaz ve sapma hesaplamaz.
  assert.doesNotMatch(ui, /setItem\(BOM_CONTROL_PREF_KEY/);
  assert.doesNotMatch(ui, /\.evaluate\(|\.analyze\(/);
  assert.match(read('public/index.html'), /plm-bom\.js\?v=__BL_ASSET_VERSION__&rev=2/);
});

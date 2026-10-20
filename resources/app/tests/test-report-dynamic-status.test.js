'use strict';
/* Test raporu / mail analizi → checklist durumu dinamik eşleşir.
   Kullanıcı "Lack of Sample" / "In Progress" gibi özel durum eklediğinde
   Buyer Log analizi Bekliyor yerine o durumu yazar; önizlemede durum elle de
   seçilebilir. Durum menüsünde Ekler eylemi uzun listede kaybolmaz. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const E = require('../public/test-report-engine');

const ROOT = path.resolve(__dirname, '..');
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const custom = [
  { id: 'custom:lack-of-sample', name: 'Lack of Sample', resolved: false },
  { id: 'custom:in-progress', name: 'In Progress', resolved: false },
  { id: 'custom:waiting-fabric', name: 'Waiting Fabric', resolved: false },
  { id: 'custom:commercial-ok', name: 'Commercial Approval', resolved: true },
];
const suggest = reports => E.suggestChecklistStatus(E.deriveStepStatus(reports), reports, custom);

test('işleme alındı sonucu tanınır ve adımı bekletir', () => {
  assert.equal(E.normalizeResult('İşleme alındı'), 'inProgress');
  assert.equal(E.normalizeResult('In Progress'), 'inProgress');
  assert.equal(E.reportOutcome({ talepNo: '1001', genelSonuc: 'İşleme Alındı', testler: [] }).code, 'pending');
  assert.equal(E.resultLabel('inProgress', 'en'), 'In progress');
});

test('Lack of Sample analizi kullanıcı tanımlı duruma yazılır (TR ham değer dâhil)', () => {
  assert.equal(suggest([{ talepNo: '1001', genelSonuc: 'Lack of Sample', testler: [] }]).status, 'custom:lack-of-sample');
  assert.equal(suggest([{ talepNo: '1001', genelSonuc: '', testler: [{ ad: 'pH', sonuc: 'Numune yetersiz' }] }]).status, 'custom:lack-of-sample');
  assert.equal(suggest([{ talepNo: '1002', genelSonuc: 'İşleme alındı', testler: [] }]).status, 'custom:in-progress');
  assert.equal(suggest([{ talepNo: '1003', genelSonuc: 'Waiting Fabric', testler: [] }]).status, 'custom:waiting-fabric', 'sözlük dışı ham değer adla eşleşir');
});

test('çözülme anlamı korunur: red ezilmez, bekleyen adım çözülmüş duruma çevrilmez', () => {
  const failing = [{ talepNo: '1', genelSonuc: 'Fail', testler: [{ ad: 'pH', sonuc: 'Fail' }, { ad: 'Rub', sonuc: 'Lack of Sample' }] }];
  assert.equal(suggest(failing).status, 'rejected');
  assert.equal(suggest([{ talepNo: '2', genelSonuc: 'Pass', testler: [] }]).status, 'approved');
  assert.equal(E.suggestChecklistStatus(E.deriveStepStatus([{ talepNo: '3', genelSonuc: 'Lack of Sample', testler: [] }]), [], []).status, 'open', 'özel durum yoksa türetilen durum');
  const commercial = [{ talepNo: '4', genelSonuc: 'Fail', testler: [{ ad: 'pH', sonuc: 'Fail' }], kararlar: [{ test: 'pH', karar: 'Commercial Approval', tarihIso: '2026-10-01' }] }];
  assert.equal(suggest(commercial).status, 'custom:commercial-ok', 'onaylı adım yalnız çözülmüş özel duruma');
  assert.equal(E.suggestChecklistStatus({ state: '' }, [], custom).status, '');
});

test('tekrar testle geçersiz rapor durum eşleşmesine katılmaz', () => {
  const reports = [
    { talepNo: '10', genelSonuc: 'Lack of Sample', testler: [] },
    { talepNo: '11', retestOf: '10', genelSonuc: 'Pass', testler: [] },
  ];
  assert.equal(suggest(reports).status, 'approved');
});

test('LCW AI durum önerisi yalnız bilinen kimlikse kabul edilir', () => {
  const reviews = E.parseReviews([
    'talepNo=1001|step=tests|status=custom:lack-of-sample|summary=ok',
    'talepNo=1002|step=tests|status=custom:unknown|summary=ok',
  ], { talepNos: ['1001', '1002'], stepIds: ['tests'], statusIds: ['open', 'custom:lack-of-sample'] });
  assert.equal(reviews['1001'].status, 'custom:lack-of-sample');
  assert.equal(reviews['1002'].status, '');
  const ctx = E.reviewContext([], [], [{ id: 'custom:in-progress', name: 'In Progress' }]);
  assert.deepEqual(ctx.checklistStatuses, [{ id: 'custom:in-progress', name: 'In Progress', resolved: false }]);
  assert.match(read('server/lib/lcwai/lcwai-prompt.js'), /status=<context\.checklistStatuses id/);
});

test('önizleme hedef durumu dinamik seçtirir ve yazar', () => {
  const ui = read('public/test-report-import.js');
  assert.match(ui, /data-tr-status="/);
  assert.match(ui, /t\.dataset\.trStatus/);
  assert.match(ui, /T\('Checklist durumu', 'Checklist status'\)/);
  assert.match(ui, /suggestChecklistStatus\(step, reports, customStatusList\(\)\)/, 'aktarımda eşleşen özel durum yazılır');
  assert.match(ui, /if \(group\.manual\) \{ saved = assistant\(\)\.setChecklistAnswer\(analysis, entry\.itemId, group\.manual/);
  assert.match(ui, /if \(\!saved\) throw new Error/, 'failed native writes must never be counted as successful imports');
  assert.match(ui, /data-tr-ai-status/);
});

test('durum menüsü: Ekler eylemi durum listesinden önce ve menü ekrana sığar', () => {
  const sync = read('public/checklist-supplier-sync.js');
  const fn = sync.slice(sync.indexOf('function openStatusMenu('), sync.indexOf('function bindStatusCells('));
  assert.ok(fn.indexOf('data-cl-evidence>') < fn.indexOf('+ statusOptions'), 'ekler özel durumların altında kaybolmaz');
  assert.match(fn, /menu\.style\.maxHeight = height \+ 'px'/);
});

test('kayıtta ek varsa adımın Ekler alanı kapalı olsa da ekler açılabilir', () => {
  const sync = read('public/checklist-supplier-sync.js');
  assert.match(sync, /function evidenceFieldsFor\(item, answer\)[^]*?answer\.attachments\.length\) fields\.attachments = true/);
  assert.match(sync, /menu\.innerHTML = \(evidenceEnabled\(evidenceItem, menuAnswer\)/);
  assert.match(sync, /const fields = evidenceFieldsFor\(item, answer\);/);
});

'use strict';

/* BL-029 · IAS PARSİYELİ OLAN SATIRDA DEL. TYPE YAZIMI (2026-11-28)
 *
 * Gerçek Chromium + gerçek sunucu (3/3 tekrar): parsiyeli satırda Del. Type'a "Uçak" yapıştırıldığında ya da
 * menüden seçildiğinde kayıt gövdesi parsiyelin vasıtasını ("Gemi") taşıyordu. Yapıştırma, satır sırası ya da test
 * düzeneği değil: commitCpEditor → syncCpProductionLogisticSegment → rebuildCpLogisticCaches satırın görünen
 * Del. Type'ını birincil segmentten (partials[0]) yeniden yazar; gövde, yerel delmap ve geri al kaydı bu
 * türetilmiş değeri okuyordu. Sunucu delmap'i yalnız üretim/kıtlık bakiyesine uygular (parse.js
 * backlogProductionDelType); kullanıcının seçimi sessizce kayboluyordu.
 *
 * Kural: düzenlenebilir Del. Type üretim/kıtlık segmentinin vasıtasıdır (hücre de onu gösterir). Kayıt, delmap ve
 * geri al değeri oradan okunur; parsiyeli olmayan satır bugünkü gibi satır değerini kullanır.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadAppMainFunctions, extractFunction } = require('./helpers/app-main-functions');

const SOURCE = fs.readFileSync(path.join(__dirname, '..', 'public', 'app-main.js'), 'utf8');
const NORMALIZE = { gemi: 'Gemi', 'uçak': 'Uçak', ucak: 'Uçak', 'gemi+uçak': 'Gemi+Uçak', 'gemi+tır': 'Gemi+Tır' };

function harness(row, { rowSave = false } = {}) {
  const sent = [], undo = [];
  const norm = value => String(value ?? '').trim();
  const globals = {
    window: { SERVER_BACKED: true, isSavingCpBulk: () => false, isPreparingCpBulk: () => false },
    state: { cp: { rows: [row] }, overrides: { transitRules: [], delmap: {}, licensormap: {}, suppfobmap: {}, noteColumnValues: {} } },
    isAreaFrozen: () => false,
    resolveCpEditorRow: () => row,
    showToast: () => {}, L: text => text, appLang: 'tr',
    norm, turknorm: value => norm(value).toUpperCase(),
    toNum: value => (value === '' || value == null ? null : Number(value)),
    coerceDateLoose: value => value, addDays: (date, days) => `${date}+${days}`,
    normalizeTransitDelType: value => NORMALIZE[norm(value).toLocaleLowerCase('tr-TR')] || '',
    resolveTransitDaysForValues: delType => ({ days: delType === 'Uçak' ? 7 : 35 }),
    editableValuesEqual: (a, b) => norm(a) === norm(b),
    applyFormulas: () => {}, invalidateUnifiedPriorityDecisions: () => {},
    syncOrderLinePeersFromCpRow: () => 0, refreshRowEverywhere: () => {},
    pushUndo: action => undo.push(action),
    markDirty: () => fns.syncOverrideToServer(row['Order Code'], {}, row),
    // Kayıt gövdesi (syncOverrideToServer) — mevcut cp-deltype-write-intent harness'ıyla aynı.
    CP_NOTE_COLUMN_DEFS: [],
    schedulePendingOverrideWrite: (_key, _delay, run) => run(),
    cpRowSaveDebounce: ms => ms,
    overrideSyncKey: r => `${r['Order Code']}|${r['Model Name']}|${r['C.Code']}`,
    lineIdentity: r => ({ model: r['Model Name'], ccode: r['C.Code'] }),
    importedSuppFob: () => false,
    cpRowSavePlan: (_row, _code, body) => (rowSave ? { patch: body.delType !== undefined ? { delType: body.delType } : {}, units: ['delType'] } : null),
    cpRowSaveSend: (_row, _code, patch) => { sent.push({ url: '/api/overrides/rows', body: patch }); return Promise.resolve({}); },
    enqueueOverrideMutation: (_kind, url, opts) => { sent.push({ url, body: JSON.parse(opts.body) }); return Promise.resolve({}); },
    notifyOverrideSaveError: () => {},
    console: { warn: () => {} },
  };
  // P1 (eski yol bayat alanlar): gövde cpLegacyBodyWithoutUnchanged'den geçer.
  Object.assign(globals, { cpRowIsObject: v => v !== null && typeof v === 'object' && !Array.isArray(v), CP_ROW_NOTE_PAIRS: { Notes: ['Notes', 'NotesHtml'], EkNot: ['EkNot', 'EkNotHtml'] }, CP_ROW_DATE_FIELDS: { exFactory: 'ex', retailDate: 'retail', inStoreDate: 'mb' } });
  const fns = loadAppMainFunctions(['commitCpEditor', 'syncCpProductionLogisticSegment', 'rebuildCpLogisticCaches', 'cpLogisticSegments', 'cpEditableDelType', 'syncOverrideToServer', 'cpLegacyBodyWithoutUnchanged', 'cpRowSnapshot', 'cpRowStoredOf'], globals);
  const edit = value => fns.commitCpEditor({ dataset: { id: String(row._id), key: 'Del. Type', kind: 'deltype' }, value }, { refresh: false });
  return { fns, sent, undo, edit };
}

// 820002: 40 adet IAS parsiyeli (Gemi, yolda) + 60 adet üretim bakiyesi. Görünen Del. Type birincil segmentten (parsiyel).
const partialRow = (productionDelType = 'Gemi') => ({
  _id: 2, 'Order Code': 820002, 'Model Name': 'DEMO PARTIAL B', 'C.Code': 'BLK', Licensor: 'DTR',
  'Order Quantity': 100, 'Ex-factory': '2026-12-30', 'Del. Type': 'Gemi',
  _logisticSegments: [
    { kind: 'partial', delType: 'Gemi', status: 'Yolda', quantity: 40, arrival: '2026-12-24' },
    { kind: 'production', delType: productionDelType, status: 'Üretimde', quantity: 60, arrival: null },
  ],
});
const productionOnlyRow = () => ({
  _id: 1, 'Order Code': 820001, 'Model Name': 'DEMO PROD A', 'C.Code': 'BLK', Licensor: 'DTR',
  'Order Quantity': 100, 'Ex-factory': '2026-12-30', 'Del. Type': 'Gemi',
  _logisticSegments: [{ kind: 'production', delType: 'Gemi', status: 'Üretimde', quantity: 100, arrival: null }],
});

for (const rowSave of [false, true]) {
  const pathName = rowSave ? 'POST /rows' : 'eski PATCH';
  test(`${pathName}: parsiyeli satırda "Uçak" düzenlemesi gövdeye "Uçak" gider (parsiyelin "Gemi"si değil)`, () => {
    const row = partialRow('Gemi');
    const h = harness(row, { rowSave });
    assert.equal(h.edit('Uçak'), true);
    assert.equal(row._logisticSegments[1].delType, 'Uçak', 'production balance takes the user value');
    assert.equal(row['Del. Type'], 'Gemi', 'row display still follows the primary (partial) segment');
    assert.equal(h.sent.length, 1);
    assert.equal(h.sent[0].body.delType, 'Uçak');
    assert.deepEqual(JSON.parse(JSON.stringify(h.undo[0].fields)), [{ key: 'Del. Type', prev: 'Gemi', next: 'Uçak' }]);
  });
}

test('parsiyeli satırda üretim "Uçak" iken "Gemi" seçimi yok sayılmaz; geri al önceki üretim değerini tutar', () => {
  const row = partialRow('Uçak');
  const h = harness(row);
  assert.equal(h.edit('Gemi'), true, 'not a no-op just because the partial is Gemi');
  assert.equal(row._logisticSegments[1].delType, 'Gemi');
  assert.equal(h.sent[0].body.delType, 'Gemi');
  assert.deepEqual(JSON.parse(JSON.stringify(h.undo[0].fields)), [{ key: 'Del. Type', prev: 'Uçak', next: 'Gemi' }]);
});

test('parsiyeli satırda aynı üretim değeri yeniden seçilirse kayıt yapılmaz', () => {
  const row = partialRow('Uçak');
  const h = harness(row);
  assert.equal(h.edit('Uçak'), false);
  assert.equal(h.sent.length, 0);
});

test('parsiyelsiz satır: davranış değişmez (satır değeri gönderilir)', () => {
  const row = productionOnlyRow();
  const h = harness(row);
  assert.equal(h.edit('Uçak'), true);
  assert.equal(row['Del. Type'], 'Uçak');
  assert.equal(h.sent[0].body.delType, 'Uçak');
  assert.deepEqual(JSON.parse(JSON.stringify(h.undo[0].fields)), [{ key: 'Del. Type', prev: 'Gemi', next: 'Uçak' }]);
});

test('"—" (boş) seçimi bugünkü anlamını korur: üretim varsayılanı "Gemi" yazılır', () => {
  const row = partialRow('Uçak');
  const h = harness(row);
  assert.equal(h.edit(''), true);
  assert.equal(row._logisticSegments[1].delType, 'Gemi');
  assert.equal(h.sent[0].body.delType, 'Gemi');
});

test('yerel delmap, yapıştırma önizlemesi ve geri al aynı düzenlenebilir değeri (üretim segmenti) okur', () => {
  const sync = extractFunction(SOURCE, 'syncOverridesFromRow');
  assert.match(sync, /if\(row\._delTypeWrite\)\{const delType=cpEditableDelType\(row\);if\(delType\)state\.overrides\.delmap\[key\]=delType;\}/);
  assert.doesNotMatch(sync, /state\.overrides\.delmap\[key\]=row\['Del\. Type'\]/);
  const paste = extractFunction(SOURCE, 'applyCpGridPaste');
  assert.match(paste, /op\.target==='deltype'\?cpEditableDelType\(row\)/, 'preview "before" shows the editable (production) value');
  const history = extractFunction(SOURCE, 'applyHistoryAction');
  assert.match(history, /if\(historyKeys\.has\('Del\. Type'\)\)syncCpProductionLogisticSegment\(row,row\['Del\. Type'\]\);/, 'undo re-applies the recorded production value');
});

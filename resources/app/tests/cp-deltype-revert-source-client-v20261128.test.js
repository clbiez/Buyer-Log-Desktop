'use strict';

/* BL-028 · DEL. TYPE "KAYNAĞA DÖN" — İSTEMCİ (2026-11-28)
 *
 * Ayrı ve açık eylem: satırın manuel Del. Type override'ını kaldırır. "—" seçeneği bugünkü anlamını korur (üretim
 * varsayılanı Gemi YAZILIR). Eylem `_delTypeWrite={clear:true}` niyetiyle `delType: null` gönderir (iki kayıt yolu),
 * yerel delmap anahtarını siler, üretim bakiyesini tam kurulum gelene kadar sistem varsayılanıyla eşitler; geri al
 * önceki değeri açık niyetle yazar, yinele yeniden temizler. Override yoksa eylem sunulmaz ve hiçbir şey göndermez.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadAppMainFunctions, extractFunction } = require('./helpers/app-main-functions');

const SOURCE = fs.readFileSync(path.join(__dirname, '..', 'public', 'app-main.js'), 'utf8');
const INDEX = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
const NORMALIZE = { gemi: 'Gemi', 'uçak': 'Uçak', 'gemi+uçak': 'Gemi+Uçak', 'gemi+tır': 'Gemi+Tır' };
const plain = value => JSON.parse(JSON.stringify(value));

function harness(row, { rowSave = false, ackStored, ackData = {} } = {}) {
  const sent = [], undo = [], toasts = [];
  const norm = value => String(value ?? '').trim();
  const ack = () => { if (ackStored !== undefined) row._cpStored = ackStored; return Promise.resolve(ackData); };
  const globals = {
    window: { SERVER_BACKED: true, isSavingCpBulk: () => false },
    state: { cp: { rows: [row] }, overrides: { transitRules: [], delmap: {}, licensormap: {}, suppfobmap: {}, noteColumnValues: {} } },
    isAreaFrozen: () => false, resolveCpEditorRow: () => row,
    showToast: text => toasts.push(text), L: text => text, appLang: 'tr',
    norm, turknorm: value => norm(value).toUpperCase(),
    toNum: value => (value === '' || value == null ? null : Number(value)),
    coerceDateLoose: value => value, addDays: (date, days) => `${date}+${days}`,
    normalizeTransitDelType: value => NORMALIZE[norm(value).toLocaleLowerCase('tr-TR')] || '',
    resolveTransitDaysForValues: delType => ({ days: delType === 'Uçak' ? 15 : 70 }),
    applyFormulas: () => {}, invalidateUnifiedPriorityDecisions: () => {},
    // Birincil segment tek kuralı (#1254): rebuildCpLogisticCaches BLBusinessRules.selectPrimaryLogisticSegment kullanır.
    BLBusinessRules: require('../public/business-rules'),
    syncOrderLinePeersFromCpRow: () => 0, refreshRowEverywhere: () => {},
    pushUndo: action => undo.push(action),
    markDirty: () => fns.syncOverrideToServer(row['Order Code'], {}, row),
    cpRowIsObject: value => value !== null && typeof value === 'object' && !Array.isArray(value),
    // #1257: eski yol gövdesi cpLegacyBodyWithoutUnchanged'den (kuyrukta) geçer.
    CP_ROW_NOTE_PAIRS: { Notes: ['Notes', 'NotesHtml'], EkNot: ['EkNot', 'EkNotHtml'] },
    CP_NOTE_COLUMN_DEFS: [],
    schedulePendingOverrideWrite: (_key, _delay, run) => run(),
    cpRowSaveDebounce: ms => ms,
    overrideSyncKey: r => `${r['Order Code']}|${r['Model Name']}|${r['C.Code']}`,
    lineIdentity: r => ({ model: r['Model Name'], ccode: r['C.Code'] }),
    importedSuppFob: () => false,
    cpRowSavePlan: (_row, _code, body) => (rowSave ? { patch: Object.hasOwn(body, 'delType') && body.delType !== undefined ? { delType: body.delType } : {}, units: ['delType'] } : null),
    cpRowSaveSend: (_row, _code, patch) => { sent.push({ url: '/api/overrides/rows', body: patch }); return ack(); },
    enqueueOverrideMutation: (_kind, url, opts) => { sent.push({ url, body: JSON.parse(typeof opts.body === 'function' ? opts.body() : opts.body) }); return ack(); },
    notifyOverrideSaveError: () => {}, console: { warn: () => {} },
  };
  const fns = loadAppMainFunctions(['revertCpDelTypeToSource', 'cpDelTypeHasOverride', 'cpRowStoredOf', 'cpEditableDelType', 'syncCpProductionLogisticSegment', 'rebuildCpLogisticCaches', 'cpLogisticSegments', 'syncOverrideToServer', 'cpLegacyBodyWithoutUnchanged'], globals);
  const revert = () => fns.revertCpDelTypeToSource({ dataset: { id: String(row._id), key: 'Del. Type', kind: 'deltype' } });
  return { fns, sent, undo, toasts, revert, flush: () => new Promise(resolve => setImmediate(resolve)) };
}
const partialRow = (production = 'Uçak', extra = {}) => ({
  _id: 2, 'Order Code': 820002, 'Model Name': 'DEMO PARTIAL B', 'C.Code': 'BLK', Licensor: 'DTR', 'Order Quantity': 100,
  'Ex-factory': '2026-12-30', 'Del. Type': 'Gemi', _cpStored: { delType: production },
  _logisticSegments: [
    { kind: 'partial', delType: 'Gemi', status: 'Yolda', quantity: 40, arrival: '2026-12-24' },
    { kind: 'production', delType: production, status: 'Üretimde', quantity: 60, arrival: null },
  ],
  ...extra,
});

for (const rowSave of [false, true]) {
  const pathName = rowSave ? 'POST /rows' : 'eski PATCH';
  test(`${pathName}: "Kaynağa dön" delType:null gönderir (boş ya da "Gemi" değil); üretim yerelde varsayılana eşitlenir; parsiyel değişmez`, async () => {
    const row = partialRow('Uçak');
    const h = harness(row, { rowSave, ackStored: {} });
    assert.equal(h.revert(), true);
    assert.equal(h.sent.length, 1);
    assert.equal(Object.hasOwn(h.sent[0].body, 'delType'), true);
    assert.equal(h.sent[0].body.delType, null);
    assert.equal(row._logisticSegments[1].delType, 'Gemi', 'local placeholder until the full build arrives');
    assert.deepEqual(plain(row._logisticSegments[0]), { kind: 'partial', delType: 'Gemi', status: 'Yolda', quantity: 40, arrival: '2026-12-24' });
    assert.deepEqual(plain(h.undo[0]), { id: 2, fields: [{ key: 'Del. Type', prev: 'Uçak', next: 'Gemi' }], delTypeRevert: true });
    await h.flush();
    assert.equal(Object.hasOwn(row, '_delTypeWrite'), false, 'intent cleared after the save is acknowledged');
    assert.deepEqual(h.toasts, []);
  });
}

test('override yoksa eylem hiçbir şey yapmaz (sunulmaz, gönderilmez)', () => {
  const row = partialRow('Gemi', { _cpStored: {} });
  const h = harness(row);
  assert.equal(h.fns.cpDelTypeHasOverride(row), false);
  assert.equal(h.revert(), false);
  assert.equal(h.sent.length, 0);
  assert.equal(h.undo.length, 0);
});

test('onaylanmamış kendi açık düzenlemesi de override sayılır; bekleyen temizleme sayılmaz', () => {
  const h = harness(partialRow('Uçak'));
  const id = { 'Model Name': 'M', 'C.Code': 'C' };
  assert.equal(h.fns.cpDelTypeHasOverride({ ...id, _cpStored: {}, _delTypeWrite: {} }), true);
  assert.equal(h.fns.cpDelTypeHasOverride({ ...id, _cpStored: { delType: 'Uçak' }, _delTypeWrite: { clear: true } }), false);
});

test('satır kimliği yoksa (model ya da renk kodu boş) eylem sunulmaz ve gönderilmez: sunucu kimliksiz null\'u 400 ile reddeder', () => {
  for (const extra of [{ 'Model Name': '' }, { 'C.Code': '  ' }]) {
    const row = partialRow('Uçak', extra);
    const h = harness(row);
    assert.equal(h.fns.cpDelTypeHasOverride(row), false);
    assert.equal(h.revert(), false);
    assert.equal(h.sent.length, 0);
    assert.equal(Object.hasOwn(row, '_delTypeWrite'), false, 'no sticky clear intent');
  }
});

test('boş kayıtlı değer (\'\') için eylem sunulmaz (değer zaten varsayılana düşer)', () => {
  const h = harness(partialRow('Gemi'));
  assert.equal(h.fns.cpDelTypeHasOverride({ 'Model Name': 'M', 'C.Code': 'C', _cpStored: { delType: '' } }), false);
});

test('sipariş düzeyinde eski kayıt kalırsa kullanıcı bilgilendirilir (satır o değeri izler)', async () => {
  const row = partialRow('Uçak');
  const h = harness(row, { ackStored: { delType: 'Gemi+Uçak' } });
  h.revert();
  await h.flush();
  assert.equal(h.toasts.length, 1);
  assert.match(h.toasts[0], /sipariş düzeyinde eski bir Del\. Type/);
});

test('satır kaydı çakışmasında (başkasının değeri korundu) eski kayıt uyarısı gösterilmez', async () => {
  const row = partialRow('Uçak');
  const h = harness(row, { rowSave: true, ackStored: { delType: 'Gemi+Tır' }, ackData: { conflicts: [{ fields: ['delType'] }] } });
  h.revert();
  await h.flush();
  assert.deepEqual(h.toasts, []);
});

test('satır kaydı planı: delType temizlemesi null kalır ("" olmaz); diğer skaler alanlar değişmez', () => {
  const { cpRowUnitAssign } = loadAppMainFunctions(['cpRowUnitAssign', 'cpRowUnitParts'], { CP_ROW_NOTE_PAIRS: { Notes: ['Notes', 'NotesHtml'], EkNot: ['EkNot', 'EkNotHtml'] } });
  assert.deepEqual(plain(cpRowUnitAssign({}, 'delType', null)), { delType: null });
  assert.deepEqual(plain(cpRowUnitAssign({}, 'delType', undefined)), { delType: '' }, 'missing base stays ""');
  assert.deepEqual(plain(cpRowUnitAssign({}, 'delType', 'Uçak')), { delType: 'Uçak' });
  assert.deepEqual(plain(cpRowUnitAssign({}, 'subManufacturer', null)), { subManufacturer: '' });
  const { cpRowPatchUnits } = loadAppMainFunctions(['cpRowPatchUnits'], { cpRowIsObject: v => v !== null && typeof v === 'object' && !Array.isArray(v), CP_ROW_NOTE_PAIRS: {}, CP_ROW_DATE_FIELDS: {} });
  assert.deepEqual(plain(cpRowPatchUnits({ model: 'M', ccode: 'C', delType: null })), { current: {}, units: ['delType'] }, 'acknowledged clear moves the stored value too');
});

test('kaynak sözleşmesi: yerel delmap silinir; yinele yeniden temizler; "—" anlamı değişmez; menü TR/EN ve yalnız override varken', () => {
  const sync = extractFunction(SOURCE, 'syncOverridesFromRow');
  assert.match(sync, /if\(row\._delTypeWrite\?\.clear\)delete state\.overrides\.delmap\[key\];/);
  const commit = extractFunction(SOURCE, 'commitCpEditor');
  assert.doesNotMatch(commit, /clear:true/, '"—" (empty choice) still goes through commitCpEditor as a value');
  assert.match(SOURCE, /window\.revertCpDelTypeToSource=revertCpDelTypeToSource;/);
  assert.match(INDEX, /window\.cpDelTypeRevertAvailable\?\.\(btn\.dataset\)/, 'availability is asked when the menu opens');
  assert.match(INDEX, /en\?'Revert to source':'Kaynağa dön'/);
  assert.match(INDEX, /window\.revertCpDelTypeToSource\?\.\(editor\)/);
  // Hücre çizimi (büyük tablo sıcak yolu) değişmez: override yalnız menü açılışında sorulur.
  assert.doesNotMatch(extractFunction(SOURCE, 'cpLogisticDelTypeCellHtml'), /cpDelTypeHasOverride|delOverride/);
  assert.doesNotMatch(extractFunction(SOURCE, 'cellHtml'), /cpDelTypeHasOverride|delOverride/);
  assert.match(SOURCE, /window\.cpDelTypeRevertAvailable=dataset=>\{/);
});

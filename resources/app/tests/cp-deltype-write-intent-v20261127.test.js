'use strict';

/* SESSİZ DEL. TYPE OVERRIDE (2026-11-27; ADR-0003 §6H bulgusu)
 *
 * Eski kayıt gövdesi (syncOverrideToServer) her not / Supp. FOB / Sub-Manufacturer kaydında ekranda görünen
 * Del. Type'ı gönderiyor, yerel state.overrides.delmap'i de ona eşitliyordu (syncOverridesFromRow). Görünen değer
 * IAS parsiyelinden türetilmiş olabilir: kullanıcı yalnız not yazsa bile delmap override'ı oluşuyor ya da
 * değişiyor → kalan üretim bakiyesinin Del. Type'ı ve tahmini varışı istemeden değişiyordu. Ayrıca başka bir
 * kullanıcının eşzamanlı Del. Type değişikliğini ilgisiz bir kayıt eski görünen değerle ezebiliyordu ve
 * #1241'den sonra her ilgisiz kayıt tam kuruluma düşüyordu.
 *
 * Düzeltme: mevcut yazım niyeti deseni (_subManufacturerWrite) Del. Type için: _delTypeWrite yalnız kullanıcının
 * açık Del. Type düzenlemesinde (hücre / yapıştırma / toplu düzenleme commitCpEditor üzerinden) ve geri al /
 * yinele uygulamasında işaretlenir. Gövde ve yerel delmap Del. Type'ı yalnız bu niyetle taşır; bayrak kayıt
 * onaylanınca kalkar, hata durumunda yeniden deneme için kalır.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadAppMainFunctions, extractFunction } = require('./helpers/app-main-functions');

const SOURCE = fs.readFileSync(path.join(__dirname, '..', 'public', 'app-main.js'), 'utf8');

function syncHarness({ fail = false, rowSave = false } = {}) {
  const sent = [];
  const settles = [];
  let settle;
  const globals = {
    window: { SERVER_BACKED: true },
    state: { overrides: { licensormap: {}, suppfobmap: {}, noteColumnValues: {} } },
    CP_NOTE_COLUMN_DEFS: [],
    schedulePendingOverrideWrite: (_key, _delay, run) => run(),
    cpRowSaveDebounce: ms => ms,
    overrideSyncKey: row => `${row['Order Code']}|${row['Model Name']}|${row['C.Code']}`,
    lineIdentity: row => ({ model: row['Model Name'], ccode: row['C.Code'] }),
    turknorm: value => String(value || '').toUpperCase(),
    norm: value => String(value ?? '').trim(),
    importedSuppFob: () => false,
    // rowSave: CP satır kaydı (POST /rows) — plan yalnız gövdedeki dokunulmuş birimleri taşır.
    cpRowSavePlan: (_row, _code, body) => (rowSave ? { patch: body.delType !== undefined ? { delType: body.delType } : { notes: body.notes }, units: body.delType !== undefined ? ['delType'] : ['notes:Notes'] } : null),
    cpRowSaveSend: (_row, _code, patch) => { sent.push({ url: '/api/overrides/rows', body: patch }); return new Promise((resolve, reject) => { const fn = () => (fail ? reject(new Error('x')) : resolve({})); settles.push(fn); settle = fn; }); },
    enqueueOverrideMutation: (_kind, url, opts) => { sent.push({ url, body: JSON.parse(opts.body) }); return new Promise((resolve, reject) => { const fn = () => (fail ? reject(new Error('x')) : resolve({})); settles.push(fn); settle = fn; }); },
    notifyOverrideSaveError: () => {},
    appLang: 'tr',
    console: { warn: () => {} },
  };
  // BL-029: gövde düzenlenebilir Del. Type'ı cpEditableDelType ile okur (segmentsiz satırda satır değeri).
  globals.normalizeTransitDelType = value => String(value ?? '').trim();
  // P1 (eski yol bayat alanlar): gövde cpLegacyBodyWithoutUnchanged'den geçer.
  Object.assign(globals, { cpRowIsObject: v => v !== null && typeof v === 'object' && !Array.isArray(v), CP_ROW_NOTE_PAIRS: { Notes: ['Notes', 'NotesHtml'], EkNot: ['EkNot', 'EkNotHtml'] }, CP_ROW_DATE_FIELDS: { exFactory: 'ex', retailDate: 'retail', inStoreDate: 'mb' } });
  const fns = loadAppMainFunctions(['syncOverrideToServer', 'cpEditableDelType', 'cpLogisticSegments', 'cpLegacyBodyWithoutUnchanged', 'cpRowSnapshot', 'cpRowStoredOf'], globals);
  return { ...fns, sent, settle: async () => { settle(); await new Promise(r => setImmediate(r)); }, settleAt: async i => { settles[i](); await new Promise(r => setImmediate(r)); } };
}
const cpRow = extra => ({ 'Order Code': 4100001, 'Model Name': 'MODEL-1', 'C.Code': 'C01', 'Del. Type': 'Uçak', Licensor: 'DTR', ...extra });

test('ilgisiz kayıt (not / Supp. FOB) Del. Type göndermez — görünen değer parsiyelden türetilmiş olabilir', async () => {
  const h = syncHarness();
  const row = cpRow();
  h.syncOverrideToServer(4100001, { Notes: 'yeni not' }, row);
  assert.equal(h.sent.length, 1);
  assert.equal(Object.hasOwn(h.sent[0].body, 'delType'), false);
  // Eski yol not çiftini (metin + Html) taşır; yalnız değişen çift gider (P1, bayat not ezme düzeltmesi).
  assert.deepEqual(JSON.parse(JSON.stringify(h.sent[0].body.notes)), { Notes: 'yeni not', NotesHtml: '' });
});

test('açık Del. Type düzenlemesi gönderilir; bayrak onaydan sonra kalkar, sonraki ilgisiz kayıt göndermez', async () => {
  const h = syncHarness();
  const row = cpRow({ _delTypeWrite: {} });
  h.syncOverrideToServer(4100001, {}, row);
  assert.equal(h.sent[0].body.delType, 'Uçak');
  await h.settle();
  assert.equal(Object.hasOwn(row, '_delTypeWrite'), false);
  h.syncOverrideToServer(4100001, { Notes: 'sonra' }, row);
  assert.equal(Object.hasOwn(h.sent[1].body, 'delType'), false);
});

test('kayıt başarısızsa niyet korunur (yeniden denemede Del. Type yine gider)', async () => {
  const h = syncHarness({ fail: true });
  const row = cpRow({ _delTypeWrite: {} });
  h.syncOverrideToServer(4100001, {}, row);
  await h.settle();
  assert.ok(row._delTypeWrite, 'intent kept after a failed save');
});

test('yerel delmap yalnız açık Del. Type niyetiyle güncellenir', () => {
  const fn = extractFunction(SOURCE, 'syncOverridesFromRow');
  // BL-029: değer satırın görünen (parsiyelden türetilebilen) Del. Type'ından değil düzenlenebilir değerden okunur.
  assert.match(fn, /if\(row\._delTypeWrite\)\{const delType=cpEditableDelType\(row\);if\(delType\)state\.overrides\.delmap\[key\]=delType;\}/);
  assert.doesNotMatch(fn, /\n\s*if\(row\['Del\. Type'\]\)state\.overrides\.delmap\[key\]=/);
});

test('niyet yalnız kullanıcının Del. Type düzenlemesinde ve geri al / yinelede işaretlenir; taslak onayı onu satıra kopyalamaz', () => {
  const commit = extractFunction(SOURCE, 'commitCpEditor');
  const at = commit.indexOf("if(kind==='deltype'){");
  assert.ok(at > 0, 'Del. Type branch exists in commitCpEditor');
  const edit = commit.slice(at, at + 400);
  assert.match(edit, /row\._delTypeWrite=\{\};/);
  assert.match(SOURCE, /if\(historyKeys\.has\('Del\. Type'\)\)row\._delTypeWrite=\{\};/);
  assert.match(SOURCE, /\['_pricingManualWrite','_pricingHistoryRestore','_subManufacturerWrite','_delTypeWrite'\]\.includes\(key\)/);
  assert.equal((SOURCE.match(/_delTypeWrite=\{\}/g) || []).length, 2, 'no other path claims Del. Type intent');
});

for (const rowSave of [false, true]) {
  const pathName = rowSave ? 'POST /rows' : 'eski PATCH';
  test(`${pathName}: açık düzenleme → onay niyeti temizler → başka kullanıcının değeri gelir → ilgisiz kayıt onu ezmez`, async () => {
    const h = syncHarness({ rowSave });
    const row = cpRow({ _delTypeWrite: {}, 'Del. Type': 'Uçak' });
    h.syncOverrideToServer(4100001, {}, row);
    assert.equal(h.sent[0].body.delType, 'Uçak');
    await h.settle();
    assert.equal(Object.hasOwn(row, '_delTypeWrite'), false, 'intent cleared after a successful save');
    row['Del. Type'] = 'Kara'; // başka kullanıcının canlı değişikliği satıra yansıdı (niyet yok)
    h.syncOverrideToServer(4100001, { Notes: 'ilgisiz' }, row);
    assert.equal(Object.hasOwn(h.sent[1].body, 'delType'), false, 'unrelated save never carries Del. Type');
  });
  test(`${pathName}: eski kaydın onayı daha yeni yazma niyetini temizlemez`, async () => {
    const h = syncHarness({ rowSave });
    const row = cpRow({ _delTypeWrite: {}, 'Del. Type': 'Uçak' });
    h.syncOverrideToServer(4100001, {}, row); // kayıt 1 (yolda)
    const newer = {}; row._delTypeWrite = newer; row['Del. Type'] = 'Kara'; // kayıt 1 onaylanmadan yeni düzenleme
    await h.settleAt(0); // kayıt 1 onayı
    assert.equal(row._delTypeWrite, newer, 'newer intent survives the older acknowledgement');
    h.syncOverrideToServer(4100001, {}, row);
    assert.equal(h.sent[1].body.delType, 'Kara');
    await h.settleAt(1);
    assert.equal(Object.hasOwn(row, '_delTypeWrite'), false);
  });
}

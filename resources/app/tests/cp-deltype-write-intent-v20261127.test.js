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

function syncHarness({ fail = false } = {}) {
  const sent = [];
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
    cpRowSavePlan: () => null, // eski PATCH yolu
    enqueueOverrideMutation: (_kind, url, opts) => { sent.push({ url, body: JSON.parse(opts.body) }); return new Promise((resolve, reject) => { settle = () => (fail ? reject(new Error('x')) : resolve({})); }); },
    notifyOverrideSaveError: () => {},
    appLang: 'tr',
    console: { warn: () => {} },
  };
  const fns = loadAppMainFunctions(['syncOverrideToServer'], globals);
  return { ...fns, sent, settle: async () => { settle(); await new Promise(r => setImmediate(r)); } };
}
const cpRow = extra => ({ 'Order Code': 4100001, 'Model Name': 'MODEL-1', 'C.Code': 'C01', 'Del. Type': 'Uçak', Licensor: 'DTR', ...extra });

test('ilgisiz kayıt (not / Supp. FOB) Del. Type göndermez — görünen değer parsiyelden türetilmiş olabilir', async () => {
  const h = syncHarness();
  const row = cpRow();
  h.syncOverrideToServer(4100001, { Notes: 'yeni not' }, row);
  assert.equal(h.sent.length, 1);
  assert.equal(Object.hasOwn(h.sent[0].body, 'delType'), false);
  assert.deepEqual(h.sent[0].body.notes, { Notes: 'yeni not' });
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
  assert.match(fn, /if\(row\._delTypeWrite&&row\['Del\. Type'\]\)state\.overrides\.delmap\[key\]=row\['Del\. Type'\];/);
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

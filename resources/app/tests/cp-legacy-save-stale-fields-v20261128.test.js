'use strict';

/* P1 · ESKİ KAYIT YOLU BAŞKA OTURUMUN DAHA YENİ DEĞERİNİ EZER (2026-11-28)
 *
 * Gerçek sunucu + iki Chromium istemcisi (3/3): A'nın canlı kanalı kapalı/gecikmeli iken B satır X'e not yazar.
 * A başka bir satırda satır kaydı yapar (POST /rows onayı A'nın global orders revizyonunu ilerletir ama X'in notunu
 * yenilemez), sonra X'te Supp. FOB kaydeder. Supp. FOB satır kaydına giremez → eski yol PATCH; gövde
 * (syncOverrideToServer) dokunulmamış notları (A'daki bayat değer) taşır, revizyon güncel olduğu için CAS geçer ve
 * B'nin notu sessizce silinir. Aynı gövde not sütunlarını, alt üreticiyi, lisansörü ve bu oturumun eski manuel
 * Supp. FOB'unu da her kayıtta yeniden gönderiyordu.
 *
 * Düzeltme (mevcut mekanizmalar): eski yolda satırın kayıtlı değeriyle (satır kaydının base'i, cpRowSnapshot /
 * _cpStored) aynı olan, yani bu sekmede değiştirilmemiş not / not sütunu / alt üretici / lisansör alanı gönderilmez;
 * Supp. FOB yalnız açık niyetle (_pricingManualWrite, #1243 deseni) ya da fiyat geçmişi geri yüklemesiyle gider.
 * Değiştirilmiş alan aynen gider; satır kaydı yolu değişmez.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadAppMainFunctions } = require('./helpers/app-main-functions');

const plain = value => JSON.parse(JSON.stringify(value));
const KEY = '4100001|MODEL-1|C01';

function harness({ stored = {}, overrides = {} } = {}) {
  const sent = [];
  const norm = value => String(value ?? '').trim();
  const globals = {
    window: { SERVER_BACKED: true },
    state: { overrides: { licensormap: {}, suppfobmap: {}, noteColumnValues: {}, ...overrides } },
    CP_NOTE_COLUMN_DEFS: [{ id: 'c1' }, { id: 'c2' }],
    CP_ROW_NOTE_PAIRS: { Notes: ['Notes', 'NotesHtml'], EkNot: ['EkNot', 'EkNotHtml'] },
    CP_ROW_DATE_FIELDS: { exFactory: 'ex', retailDate: 'retail', inStoreDate: 'mb' },
    cpRowIsObject: value => value !== null && typeof value === 'object' && !Array.isArray(value),
    schedulePendingOverrideWrite: (_key, _delay, run) => run(),
    cpRowSaveDebounce: ms => ms,
    overrideSyncKey: () => KEY,
    lineIdentity: row => ({ model: row['Model Name'], ccode: row['C.Code'] }),
    turknorm: value => norm(value).toUpperCase(), norm,
    normalizeTransitDelType: value => norm(value),
    importedSuppFob: () => false,
    cpRowSavePlan: () => null, // eski yol (ör. gövdede Supp. FOB var ya da satır kaydı kapalı)
    enqueueOverrideMutation: (_kind, url, opts) => { sent.push({ url, body: JSON.parse(typeof opts.body === 'function' ? opts.body() : opts.body) }); return Promise.resolve({}); },
    notifyOverrideSaveError: () => {}, appLang: 'tr', console: { warn: () => {} },
  };
  const fns = loadAppMainFunctions(['syncOverrideToServer', 'cpLegacyBodyWithoutUnchanged', 'cpRowSnapshot', 'cpRowStoredOf', 'cpEditableDelType', 'cpLogisticSegments'], globals);
  const row = extra => ({ 'Order Code': 4100001, 'Model Name': 'MODEL-1', 'C.Code': 'C01', Licensor: 'NIKE', 'Sub-Manufacturer': 'SUB-A', 'Supp. FOB': 7.5, _cpStored: stored, ...extra });
  return { fns, sent, row };
}
const fullNotes = (text, extra = {}) => ({ Notes: text, NotesHtml: '', EkNot: '', EkNotHtml: '', NotesAt: '2026-11-01T00:00:00Z', ...extra });

test('Supp. FOB kaydı (eski yol) dokunulmamış bayat notu göndermez — başka oturumun notu ezilmez', () => {
  // A'nın satırı ve kayıtlı değeri aynı (A notu değiştirmedi); sunucuda B'nin daha yeni notu var.
  const h = harness({ stored: { notes: { Notes: '', NotesHtml: '', EkNot: '', EkNotHtml: '' }, subManufacturer: 'SUB-A' }, overrides: { suppfobmap: { [KEY]: 9.25 } } });
  const row = h.row({ _suppFobManual: true, _pricingManualWrite: {}, 'Supp. FOB': 9.25 });
  h.fns.syncOverrideToServer(4100001, fullNotes(''), row);
  assert.equal(h.sent.length, 1);
  const body = h.sent[0].body;
  assert.equal(Object.hasOwn(body, 'notes'), false, 'untouched notes are not sent');
  assert.equal(Object.hasOwn(body, 'subManufacturer'), false, 'untouched sub-manufacturer is not sent');
  assert.equal(body.suppFob, 9.25);
  assert.deepEqual(plain(body.suppFobMeta), { source: 'manual' });
  assert.equal(body.model, 'MODEL-1');
});

test('değiştirilmiş not çifti (ve yalnız o çift) eski yolda gönderilir', () => {
  const h = harness({ stored: { notes: { Notes: 'eski', NotesHtml: '', EkNot: 'ek', EkNotHtml: '' } } });
  h.fns.syncOverrideToServer(4100001, fullNotes('yeni', { EkNot: 'ek' }), h.row({ Licensor: 'DTR' }));
  assert.deepEqual(plain(h.sent[0].body.notes), { Notes: 'yeni', NotesHtml: '' });
});

test('not silme (kayıtlı değer → boş) gönderilir', () => {
  const h = harness({ stored: { notes: { Notes: 'B notu', NotesHtml: '', EkNot: '', EkNotHtml: '' } } });
  h.fns.syncOverrideToServer(4100001, fullNotes(''), h.row({ Licensor: 'DTR' }));
  assert.deepEqual(plain(h.sent[0].body.notes), { Notes: '', NotesHtml: '' });
});

test('not sütunları: yalnız kayıtlı değerden farklı olan sütun gider', () => {
  const h = harness({ stored: { noteColumns: { c1: 'a', c2: 'b' } }, overrides: { noteColumnValues: { [KEY]: { c1: 'a', c2: 'B2' } } } });
  h.fns.syncOverrideToServer(4100001, fullNotes(''), h.row({ Licensor: 'DTR' }));
  assert.deepEqual(plain(h.sent[0].body.noteColumns), { c2: 'B2' });
});

test('Supp. FOB yalnız açık niyetle gider: önceki manuel fiyat sonraki ilgisiz kayıtta yeniden gönderilmez', () => {
  const h = harness({ stored: {}, overrides: { suppfobmap: { [KEY]: 9.25 } } });
  const row = h.row({ _suppFobManual: true, 'Supp. FOB': 9.25, Licensor: 'DTR' });
  h.fns.syncOverrideToServer(4100001, fullNotes('not'), row);
  assert.equal(Object.hasOwn(h.sent[0].body, 'suppFob'), false);
  assert.equal(Object.hasOwn(h.sent[0].body, 'suppFobMeta'), false);
});

test('alt üretici: açık niyet (_subManufacturerWrite) ya da kayıtlı değerden farklılık varsa gider', () => {
  const same = harness({ stored: { subManufacturer: 'SUB-A' } });
  same.fns.syncOverrideToServer(4100001, fullNotes(''), same.row({ _subManufacturerWrite: {} }));
  assert.equal(same.sent[0].body.subManufacturer, 'SUB-A', 'explicit intent keeps the field');
  const changed = harness({ stored: { subManufacturer: 'SUB-A' } });
  changed.fns.syncOverrideToServer(4100001, fullNotes(''), changed.row({ 'Sub-Manufacturer': 'SUB-B' }));
  assert.equal(changed.sent[0].body.subManufacturer, 'SUB-B');
});

test('lisansör: kayıtlı değerle aynıysa gönderilmez; fiyat geçmişi geri yüklemesi her zaman gider', () => {
  const h = harness({ stored: { licensor: 'NIKE' }, overrides: { licensormap: { [KEY]: 'NIKE' } } });
  h.fns.syncOverrideToServer(4100001, fullNotes(''), h.row({ _licensorManual: true }));
  assert.equal(Object.hasOwn(h.sent[0].body, 'licensor'), false);
  const r = harness({ stored: { licensor: 'NIKE' }, overrides: { licensormap: { [KEY]: 'NIKE' } } });
  r.fns.syncOverrideToServer(4100001, fullNotes(''), r.row({ _licensorManual: true, _pricingHistoryRestore: { licensor: { present: true, value: 'NIKE' } } }));
  assert.equal(r.sent[0].body.licensor, 'NIKE');
  assert.deepEqual(plain(r.sent[0].body.pricingRestore), { licensor: { present: true } });
});

test('satır kaydı yolu değişmez: plan tam gövdeyi alır (dokunulan birimler orada seçilir)', () => {
  const seen = [];
  const h = harness({ stored: { notes: { Notes: '', NotesHtml: '', EkNot: '', EkNotHtml: '' } } });
  h.fns.context.cpRowSavePlan = (_row, _code, body) => { seen.push(body); return { skip: true }; };
  h.fns.syncOverrideToServer(4100001, fullNotes(''), h.row({ Licensor: 'DTR' }));
  assert.equal(h.sent.length, 0);
  assert.equal(Object.hasOwn(seen[0], 'notes'), true);
});

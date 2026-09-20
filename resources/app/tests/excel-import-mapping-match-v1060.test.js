'use strict';

/*
 * KULLANICI EXCEL'İ İÇERİ AKTARMA — EŞLEME VE EŞLEŞTİRME
 *
 * Çivilenen davranışlar:
 *   1) Kanonik alan takma adları öneri üretir; öneri güven derecesi taşır ve
 *      düşük/orta güven kullanıcı onayı ister.
 *   2) Aynı Buyer Log alanına iki kaynak sütunu eşlenemez.
 *   3) Yeni sütun (custom) eşlemesi ad ister ve mevcut adla çakışamaz.
 *   4) Kimlik alanları SAYI DEĞİLDİR: "0123" ile "123" farklı anahtardır.
 *   5) Eşleşme birebirdir: exact / ambiguous / none / invalid.
 *   6) Belirsiz eşleşmede İLK SONUÇ otomatik seçilmez.
 *   7) Excel içi tekrar ve TERS tekrar (çok satır → tek hedef) ayrı ayrı
 *      yüzeye çıkar.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

globalThis.BLCanonicalFields = require('../public/canonical-fields.js');
require('../public/column-schema.js');
const Mapping = require('../public/excel-import-mapping.js');
const Match = require('../public/excel-import-match.js');

const FIELDS = [
  { id: 'plmId', label: 'PLM ID', dataType: 'code', identity: true, writable: true, canonicalId: 'plmId', aliases: ['PLM ID'] },
  { id: 'colourCode', label: 'Colour Code', dataType: 'code', identity: true, writable: true, canonicalId: 'colourCode', aliases: ['Colour Code', 'C.Code', 'Renk Kodu'] },
  { id: 'targetPrice', label: 'Target Price', dataType: 'currency', writable: true, aliases: ['Target Price'] },
  { id: 'exFactory', label: 'Ex-Factory', dataType: 'date', writable: true, aliases: ['Ex-Factory', 'Ex Factory'] },
  { id: 'not', label: 'Notes', dataType: 'text', writable: true, aliases: ['Notes', 'Not'] },
  { id: 'fob', label: 'FOB', dataType: 'currency', writable: false, aliases: ['FOB'] },
];
const column = (index, header) => ({ id: 'col:' + index, index, letter: String.fromCharCode(65 + index), header, rawHeader: header, key: Mapping.token(header) });

test('takma adlar yüksek güvenli öneri üretir', () => {
  const columns = [column(0, 'PLM ID'), column(1, 'Renk Kodu'), column(2, 'Target Price')];
  const assignments = Mapping.suggestMapping(columns, FIELDS);
  assert.equal(assignments['col:0'].targetId, 'plmId');
  assert.equal(assignments['col:0'].confidence, 'high');
  assert.equal(assignments['col:1'].targetId, 'colourCode');
  assert.equal(assignments['col:2'].targetId, 'targetPrice');
  assert.equal(assignments['col:2'].needsReview, false);
});

test('belirsiz/zayıf öneri gözden geçirme ister ve tek başına plana giremez', () => {
  const columns = [column(0, 'Target Prc.')];
  const assignments = Mapping.suggestMapping(columns, FIELDS);
  const entry = assignments['col:0'];
  assert.ok(['medium', 'low'].includes(entry.confidence), String(entry.confidence));
  assert.equal(entry.needsReview, true);
  const validation = Mapping.validateMapping({ assignments, fields: FIELDS, columns, matchFields: ['targetPrice'] });
  assert.ok(validation.issues.some(issue => issue.code === 'suggestion-needs-review'));
});

test('aynı hedefe iki kaynak sütun eşlenemez', () => {
  const columns = [column(0, 'PLM ID'), column(1, 'PLM Code')];
  const assignments = { 'col:0': { targetId: 'plmId' }, 'col:1': { targetId: 'plmId' } };
  const validation = Mapping.validateMapping({ assignments, fields: FIELDS, columns, matchFields: ['plmId'] });
  assert.equal(validation.ok, false);
  assert.ok(validation.issues.some(issue => issue.code === 'duplicate-target-mapping'));
});

test('otomatik eşleme aynı hedefi iki kez rezerve etmez', () => {
  const columns = [column(0, 'PLM ID'), column(1, 'PLM Code')];
  const assignments = Mapping.suggestMapping(columns, FIELDS);
  const targets = Object.keys(assignments).map(id => assignments[id].targetId).filter(id => id !== Mapping.IGNORE);
  assert.equal(new Set(targets).size, targets.length);
});

test('bir kaynak sütun birden çok anlamsal alanı açık kural olmadan süremez', () => {
  const columns = [column(0, 'PLM ID')];
  const assignments = { 'col:0': { targetId: 'plmId', additionalTargets: ['colourCode'] } };
  const validation = Mapping.validateMapping({ assignments, fields: FIELDS, columns, matchFields: ['plmId'] });
  assert.equal(validation.ok, false);
  assert.ok(validation.issues.some(issue => issue.code === 'one-source-many-targets'));
});

test('yeni sütun eşlemesi ad ister ve mevcut alan adıyla çakışamaz', () => {
  const columns = [column(0, 'Serbest Alan'), column(1, 'PLM ID')];
  const missing = Mapping.validateMapping({
    assignments: { 'col:0': { targetId: '__new__' }, 'col:1': { targetId: 'plmId' } },
    fields: FIELDS, columns, matchFields: ['plmId'],
  });
  assert.ok(missing.issues.some(issue => issue.code === 'new-column-label-required'));

  const clash = Mapping.validateMapping({
    assignments: { 'col:0': { targetId: '__new__', newColumnLabel: 'Notes' }, 'col:1': { targetId: 'plmId' } },
    fields: FIELDS, columns, matchFields: ['plmId'],
  });
  assert.ok(clash.issues.some(issue => issue.code === 'new-column-label-exists'));

  const ok = Mapping.validateMapping({
    assignments: { 'col:0': { targetId: '__new__', newColumnLabel: 'Serbest Alan', newColumnType: 'text' }, 'col:1': { targetId: 'plmId' } },
    fields: FIELDS, columns, matchFields: ['plmId'],
  });
  assert.equal(ok.ok, true);
  assert.equal(ok.newColumns.length, 1);
});

test('yazılamayan alan yalnız eşleşme için kullanılabilir', () => {
  const columns = [column(0, 'FOB'), column(1, 'PLM ID')];
  const validation = Mapping.validateMapping({
    assignments: { 'col:0': { targetId: 'fob' }, 'col:1': { targetId: 'plmId' } },
    fields: FIELDS, columns, matchFields: ['plmId'],
  });
  assert.equal(validation.ok, true, 'uyarıdır, engel değil');
  assert.ok(validation.issues.some(issue => issue.code === 'target-not-writable' && issue.severity === 'warning'));
});

test('eşleşme kuralı zorunludur ve eşlenmemiş alanla kurulamaz', () => {
  const columns = [column(0, 'PLM ID')];
  const noRule = Mapping.validateMapping({ assignments: { 'col:0': { targetId: 'plmId' } }, fields: FIELDS, columns, matchFields: [] });
  assert.ok(noRule.issues.some(issue => issue.code === 'match-rule-required'));
  const unmapped = Mapping.validateMapping({ assignments: { 'col:0': { targetId: 'plmId' } }, fields: FIELDS, columns, matchFields: ['colourCode'] });
  assert.ok(unmapped.issues.some(issue => issue.code === 'match-field-not-mapped'));
});

test('tip sezgisi öneridir ve baştaki sıfır kimliği ele verir', () => {
  assert.equal(Mapping.inferColumnType(['0123', '0456'], 'Renk Kodu').dataType, 'code');
  assert.equal(Mapping.inferColumnType(['12.5', '3'], 'Fiyat').dataType, 'number');
  assert.equal(Mapping.inferColumnType(['2026-01-02', '2026-03-04'], 'Ex-Factory Tarihi').dataType, 'date');
  assert.equal(Mapping.inferColumnType(['Evet', 'Hayır'], 'Onay').dataType, 'boolean');
  assert.equal(Mapping.inferColumnType(['abc', 'def'], 'Serbest').dataType, 'text');
});

/* ---------------- EŞLEŞTİRME ---------------- */

const matchFields = [{ id: 'plmId', dataType: 'code' }, { id: 'colourCode', dataType: 'code' }];
const targetRows = [
  { plmId: '0123', colourCode: '001', name: 'A' },
  { plmId: '0123', colourCode: '002', name: 'B' },
  { plmId: '0124', colourCode: '001', name: 'C' },
  { plmId: '0124', colourCode: '001', name: 'D' },   // aynı bileşik anahtar → belirsiz
];
const readValue = (row, fieldId) => row[fieldId];

test('kimlik alanı sayı değildir: baştaki sıfır anlamlıdır', () => {
  assert.equal(Match.normalizeKeyValue('0123', 'code'), '0123');
  assert.notEqual(Match.normalizeKeyValue('0123', 'code'), Match.normalizeKeyValue('123', 'code'));
  // Excel'in sayıya çevirmesinden kalan ".0" kuyruğu bir sayı yorumu değil,
  // biçim artığıdır ve atılır.
  assert.equal(Match.normalizeKeyValue('123.0', 'code'), '123');
});

test('bileşik anahtarda eksik parça kimliği geçersiz kılar', () => {
  assert.equal(Match.keyOf({ plmId: '0123', colourCode: '' }, matchFields), '');
  assert.notEqual(Match.keyOf({ plmId: '0123', colourCode: '001' }, matchFields), '');
});

test('exact / none / ambiguous / invalid doğru sınıflanır ve ilk sonuç seçilmez', () => {
  const index = Match.buildTargetIndex(targetRows, matchFields, readValue);
  const result = Match.classifyMatches({
    matchFields, targetIndex: index,
    incoming: [
      { id: 'r1', excelRow: 2, values: { plmId: '0123', colourCode: '001' } },
      { id: 'r2', excelRow: 3, values: { plmId: '0999', colourCode: '001' } },
      { id: 'r3', excelRow: 4, values: { plmId: '0124', colourCode: '001' } },
      { id: 'r4', excelRow: 5, values: { plmId: '', colourCode: '' } },
    ],
  });
  const byId = new Map(result.results.map(item => [item.sourceRowId, item]));
  assert.equal(byId.get('r1').status, 'exact');
  assert.equal(byId.get('r1').targets[0].row.name, 'A');
  assert.equal(byId.get('r2').status, 'none');
  assert.equal(byId.get('r3').status, 'ambiguous');
  assert.equal(byId.get('r3').targets.length, 2);
  assert.ok(!('chosen' in byId.get('r3')), 'belirsiz eşleşmede otomatik seçim yok');
  assert.equal(byId.get('r4').status, 'invalid');
});

test('Excel içindeki tekrar eden anahtarlar bildirilir', () => {
  const index = Match.buildTargetIndex(targetRows, matchFields, readValue);
  const result = Match.classifyMatches({
    matchFields, targetIndex: index,
    incoming: [
      { id: 'r1', excelRow: 2, values: { plmId: '0123', colourCode: '001' } },
      { id: 'r2', excelRow: 3, values: { plmId: '0123', colourCode: '001' } },
    ],
  });
  assert.equal(result.incomingDuplicates.length, 1);
  assert.deepEqual(result.incomingDuplicates[0].sourceRowIds, ['r1', 'r2']);
  // Aynı hedefe düşerler: ters tekrar da görünür olmalı.
  assert.equal(result.reverseDuplicates.length, 1);
});

test('farklı anahtarlı iki satır tek hedefe düşerse ters tekrar raporlanır', () => {
  const rows = [{ plmId: '0123', colourCode: '001' }];
  const singleField = [{ id: 'plmId', dataType: 'code' }];
  const index = Match.buildTargetIndex(rows, singleField, readValue);
  const result = Match.classifyMatches({
    matchFields: singleField, targetIndex: index,
    incoming: [
      { id: 'r1', excelRow: 2, values: { plmId: '0123' } },
      { id: 'r2', excelRow: 3, values: { plmId: '0123' } },
    ],
  });
  assert.equal(result.reverseDuplicates.length, 1);
  assert.equal(result.reverseDuplicates[0].targetPosition, 0);
});

test('benzerlik yalnız ÖNERİ üretir, kesin eşleşme üretmez', () => {
  const rows = [{ plmId: 'MODEL-0123' }];
  const singleField = [{ id: 'plmId', dataType: 'text' }];
  const index = Match.buildTargetIndex(rows, singleField, readValue);
  const result = Match.classifyMatches({
    matchFields: singleField, targetIndex: index,
    incoming: [{ id: 'r1', excelRow: 2, values: { plmId: 'MODEL-01234' } }],
  });
  assert.equal(result.results[0].status, 'none');
  assert.ok(Array.isArray(result.results[0].suggestions));
});

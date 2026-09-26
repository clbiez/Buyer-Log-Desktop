'use strict';

/* Siparişler ilk girişi (30k satır) profilinde iki saf CPU sıcak noktası:
   - column-schema inferType her sütunun tüm değerleri için tarih ayrıştırma
     dizisini koşulsuz üretiyordu (tarih kanıtı olmayan sayısal/metin
     sütunlarda bile) ve sayı dizisini ikinci kez tarıyordu (~0,65 sn).
   - model-option-stats keyText aynı model/renk metnini satır başına
     tekrar tekrar Türkçe büyük harfe çeviriyordu (~0,36 sn).
   Sonuçlar aynı kalmalı; yalnız gereksiz iş yapılmamalı. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const schema = require('../public/column-schema');
const stats = require('../public/model-option-stats');

const SCHEMA_SRC = fs.readFileSync(path.join(__dirname, '..', 'public', 'column-schema.js'), 'utf8');
const STATS_SRC = fs.readFileSync(path.join(__dirname, '..', 'public', 'model-option-stats.js'), 'utf8');

const typeOf = (field, values) => schema.resolveColumnSchema({ field }, values.map(value => ({ [field]: value }))).dataType;

test('tür çıkarımı sonuçları değişmez', () => {
  const cases = [
    ['deger', [1, 2, '3'], 'integer'], ['deger', [1, '2,5', 3], 'decimal'], ['deger', ['a', 2], 'text'],
    ['alanA', ['2026-01-02', '2026-03-04'], 'date'], ['alanA', ['2026-01-02T10:00:00', '2026-03-04'], 'datetime'],
    ['alanA', ['2026-01-02', '2026-13-40'], 'text'], ['tarihX', ['20260102'], 'date'], ['tarihX', ['20261345'], 'text'],
    ['deger', ['20261345'], 'integer'], ['kodX', ['0123', '5'], 'code/id'], ['deger', ['1.234.567', '2'], 'integer'],
  ];
  for (const [field, values, expected] of cases) assert.equal(typeOf(field, values), expected, `${field} ${JSON.stringify(values)}`);
});

test('inferType tarih ayrıştırmayı yalnız tarih kanıtı varsa yapar; sayıları tek geçişte tarar', () => {
  const start = SCHEMA_SRC.indexOf('function inferType(');
  const body = SCHEMA_SRC.slice(start, SCHEMA_SRC.indexOf('\n  }\n', start));
  assert.doesNotMatch(body, /values\.map\(strictDate\)/);
  assert.doesNotMatch(body, /values\.map\(numeric\)/);
});

test('model/renk anahtarları aynı kalır; büyük harf dönüşümü önbelleklenir ve sınırlıdır', () => {
  const rows = [
    { modelName: ' ıslak  model ', color: 'siyah', id: 'r1' },
    { modelName: 'ISLAK MODEL', color: 'Siyah', id: 'r2' },
    { modelName: 'diğer', color: 'mavi', id: 'r3' },
  ];
  assert.equal(stats.modelKey(rows[0]), stats.modelKey(rows[1]));
  assert.equal(stats.modelKey(rows[0]), 'model:ISLAK MODEL');
  const result = stats.getModelOptionStats(rows);
  assert.equal(result.modelCount, 2);
  assert.match(STATS_SRC, /KEY_TEXT_CACHE_MAX=/);
  assert.match(STATS_SRC, /keyTextCache\.size>=KEY_TEXT_CACHE_MAX\)keyTextCache\.clear\(\)/);
});

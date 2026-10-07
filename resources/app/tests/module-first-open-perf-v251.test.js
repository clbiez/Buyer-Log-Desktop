'use strict';
// Regression (7.0.251): 33 bin satırlık demo veriyle modül ilk açılışları.
// Backlog ilk açılışta ~9 sn, LFL ~5 sn ana iş parçacığını kilitliyordu;
// Backlog ziyaretinden sonra Genel Bakış'a dönüş ~4 sn sürüyordu.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = rel => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
const report = require('../public/backlog-v3-report.js');

test('Backlog V3 normalisation computes "today" once and gives the same result as per-row calculation', () => {
  const rows = [
    { STATÜ: 'Üretimde', 'Sipariş Adeti': 10, 'Revize Ex-Factory': '2026-01-05', stamp: '2026-03-09T21:00:00.000Z', note: '2026-03-09' },
    { STATÜ: 'Depoda', 'Sipariş Adeti': 5 },
  ];
  const batch = report.normalizeRows(rows, { today: '2026-02-01' });
  const single = rows.map(row => report.normalizeRow(row, { today: '2026-02-01' }));
  const strip = items => items.map(item => { const { row, ...rest } = item; return rest; });
  assert.deepEqual(strip(batch), strip(single));
  assert.deepEqual(batch[0].rawTimestampFields, ['stamp'], 'only full ISO timestamps are reported');
  const source = read('public/backlog-v3-report.js');
  assert.match(source, /if \(ctx\.todayOrdinal == null\) ctx\.todayOrdinal = ordinal\(ctx\.today \|\| todayIso\(\)\);/);
  assert.match(source, /const TURK_CACHE = new Map\(\);/);
});

test('LFL and Backlog engines memoise their pure text keys with a bounded cache', () => {
  const lfl = read('public/lfl.js');
  assert.match(lfl, /const countryKey=memoText\(/);
  assert.match(lfl, /const searchKey=memoText\(/);
  assert.match(lfl, /const searchCompact=memoText\(/);
  assert.match(lfl, /if\(cache\.size>=50000\)cache\.clear\(\);/);
  const engine = read('public/backlog-delivery-engine.js');
  assert.match(engine, /const DIM_KEY_CACHE = new Map\(\);/);
  const Engine = require('../public/backlog-delivery-engine.js');
  for (let i = 0; i < 2; i++) assert.equal(Engine.dimKey('  ışık  Şal  ÇÖĞÜ '), 'ISIK SAL COGU');
});

test('Backlog panels reuse rows of an unchanged server revision instead of re-normalising and re-analysing', () => {
  const server = read('server/server.js');
  assert.match(server, /const rowsRevision=crypto\.createHash\('sha1'\)\.update\(BACKLOG_ROWS_PROCESS_NONCE\)\.update\(detailRowsKey\)/);
  assert.match(server, /sourceColumns, sourceCatalog, rowsRevision \}\);/);
  const overview = read('public/backlog-overview.js');
  assert.match(overview, /if\(revision&&revision===rowsCache\.lastRevision&&rowsCache\.lastRows\)rows=rowsCache\.lastRows;/);
  assert.match(overview, /if\(!\(rows===normalizedRows&&baseItems\)\)baseItems=R\(\)\.normalizeRows\(rows\);/);
  const analysis = read('public/backlog-delivery-analysis.js');
  assert.match(analysis, /if \(!\(modelInputs && modelInputs\.rows === allRows && modelInputs\.key === key && state\.model\)\)/);
  assert.match(analysis, /JSON\.stringify\(\[state\.settings, periodBounds\(\), state\.preferences, state\.customRules, lang\(\), today\]\)/);
});

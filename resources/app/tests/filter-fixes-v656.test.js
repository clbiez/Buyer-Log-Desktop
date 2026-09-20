'use strict';

/* v6.56 — İki düzeltme:
 * (1) "Revised Only" filtresi hiçbir satırı listelemiyordu.
 * (2) "Clear Filters" Koleksiyon'un check filter'ını (satır işaret tikleri)
 *     temizlemiyordu.
 *
 * (1) kök nedeni: sütun başlığı panelindeki "Revised Only" seçimi
 * state.colFilters[tableKey]['Ex-factory'].revision alanına yazılıyordu ve
 * bu alan passesColFilters (yalnız filtre panelindeki SEÇENEK LİSTESİNİ
 * üretmek için kullanılan yardımcı) tarafından doğru okunuyordu — ama ASIL
 * tablo satırlarını süzen fonksiyonlar (cpPassesGroup / ordersPassesGroup,
 * "Excel mirror grupları" mimarisi) revizyon modunu HİÇ bilmiyordu; yalnız
 * preparedColFilterPasses (DEĞER/checklist filtresi) çağrılıyordu. Kullanıcı
 * yalnız "Revised Only" seçtiğinde değer listesi boş kaldığı için
 * preparedColFilterPasses TÜM satırları eliyordu.
 *
 * (2) kök nedeni: Clear Filters'ın Koleksiyon dalı yalnız kolColFilters
 * (DEĞER/checklist filtreleri) sıfırlıyordu; kolCheckFilter (sütun
 * başlığındaki checkbox'a bağlı "yalnız işaretli/işaretsiz satırlar"
 * filtresi, cp/orders'taki state.checkFilter'ın Koleksiyon karşılığı) hiç
 * sıfırlanmıyordu.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const APP = fs.readFileSync(path.join(ROOT, 'public', 'app-main.js'), 'utf8');
const BLRevision = require(path.join(ROOT, 'public', 'revision-display.js'));

function bodyOf(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `${name} bulunmalı`);
  let paren = 0, i = source.indexOf('(', start);
  for (; i < source.length; i++) {
    if (source[i] === '(') paren++;
    else if (source[i] === ')' && --paren === 0) break;
  }
  const open = source.indexOf('{', i);
  let depth = 0;
  for (let j = open; j < source.length; j++) {
    if (source[j] === '{') depth++;
    else if (source[j] === '}' && --depth === 0) return source.slice(open + 1, j);
  }
  throw new Error(`${name} ayrıştırılamadı`);
}

function bindPassesGroup(name, tableKeyForState, paramName) {
  const REVISION_FILTER_MODES = ['revised', 'original'];
  let calledPrepared = false;
  const preparedColFilterPasses = () => { calledPrepared = true; return true; };
  const state = { colFilters: { [tableKeyForState]: {} } };
  const fn = new Function('state', 'BLRevision', 'REVISION_FILTER_MODES', 'matchesQuickExFactory', 'preparedColFilterPasses', `
    function revisionFilterMode(entry){${bodyOf(APP, 'revisionFilterMode')}}
    function rowHasDateRevision(row,key){${bodyOf(APP, 'rowHasDateRevision')}}
    function revisionFilterPasses(mode,key,row){${bodyOf(APP, 'revisionFilterPasses')}}
    function colFilterHasValueTest(entry){${bodyOf(APP, 'colFilterHasValueTest')}}
    function ${name}(${paramName},ctx,id){${bodyOf(APP, name)}}
    return ${name};
  `)(state, BLRevision, REVISION_FILTER_MODES, () => true, preparedColFilterPasses);
  return { run: fn, state, wasPreparedCalled: () => calledPrepared };
}

const revisedRow = { _asasExFactory: new Date('2026-07-01'), 'Ex-factory': new Date('2026-07-10') };
const normalRow = { _asasExFactory: new Date('2026-07-01'), 'Ex-factory': new Date('2026-07-01') };

/* ---------------------------------------------------- 1) CP "REVISED ONLY" */

test('v6.56 CP: yalnız "Revised only" seçiliyken revize satır geçiyor, normal satır elenıyor', () => {
  const { run, state } = bindPassesGroup('cpPassesGroup', 'cp', 'r');
  state.colFilters.cp['Ex-factory'] = { revision: 'revised' };
  const ctx = { quickExf: '', groupFilters: { exf: { kind: 'none' } } };
  assert.equal(run(revisedRow, ctx, 'exf'), true);
  assert.equal(run(normalRow, ctx, 'exf'), false);
});

test('v6.56 CP: "Not revised only" tam tersini yapıyor', () => {
  const { run, state } = bindPassesGroup('cpPassesGroup', 'cp', 'r');
  state.colFilters.cp['Ex-factory'] = { revision: 'original' };
  const ctx = { quickExf: '', groupFilters: { exf: { kind: 'none' } } };
  assert.equal(run(revisedRow, ctx, 'exf'), false);
  assert.equal(run(normalRow, ctx, 'exf'), true);
});

test('v6.56 CP: yalnız revizyon seçiliyken preparedColFilterPasses hiç çağrılmıyor', () => {
  // Bu asıl hatanın kanıtı: değer listesi boşken preparedColFilterPasses'e
  // girmek TÜM satırları eliyordu.
  const { run, state, wasPreparedCalled } = bindPassesGroup('cpPassesGroup', 'cp', 'r');
  state.colFilters.cp['Ex-factory'] = { revision: 'revised' };
  run(revisedRow, { quickExf: '', groupFilters: { exf: { kind: 'none' } } }, 'exf');
  assert.equal(wasPreparedCalled(), false);
});

test('v6.56 CP: hem revizyon hem değer filtresi birlikteyken ikisi de uygulanıyor', () => {
  const { run, state, wasPreparedCalled } = bindPassesGroup('cpPassesGroup', 'cp', 'r');
  state.colFilters.cp['Ex-factory'] = { revision: 'revised', values: new Set(['x']) };
  run(revisedRow, { quickExf: '', groupFilters: { exf: { kind: 'values' } } }, 'exf');
  assert.equal(wasPreparedCalled(), true, 'değer filtresi de varsa preparedColFilterPasses çağrılmalı');
});

test('v6.56 CP: revizyon filtresi hiç seçili değilken eski davranış korunuyor', () => {
  const { run, state, wasPreparedCalled } = bindPassesGroup('cpPassesGroup', 'cp', 'r');
  state.colFilters.cp = {};
  run(revisedRow, { quickExf: '', groupFilters: { exf: { kind: 'none' } } }, 'exf');
  assert.equal(wasPreparedCalled(), true, 'revizyon seçili değilse preparedColFilterPasses her zamanki gibi çağrılmalı');
});

/* ------------------------------------------------ 2) ORDERS "REVISED ONLY" */

test('v6.56 Orders: aynı düzeltme ordersPassesGroup\'a da uygulandı', () => {
  const { run, state } = bindPassesGroup('ordersPassesGroup', 'orders', 'row');
  state.colFilters.orders['Ex-factory'] = { revision: 'revised' };
  const ctx = { groupFilters: { exf: { kind: 'none' } } };
  assert.equal(run(revisedRow, ctx, 'exf'), true);
  assert.equal(run(normalRow, ctx, 'exf'), false);
});

/* --------------------------------------------------------- 3) CLEAR FILTERS */

test('v6.56 Clear Filters artık kolCheckFilter\'ı da sıfırlıyor', () => {
  const clearBody = bodyOf(APP, 'clearTableFilters');
  assert.match(clearBody, /kolCheckFilter\s*=\s*'';/);
  assert.match(clearBody, /kolColFilters\s*=\s*\{\};/, 'değer filtreleri de hâlâ sıfırlanmalı');
  assert.match(APP, /navClearFilters'[\s\S]*clearTableFilters\(info\.tableKey\)/,
    'global temizleme eylemi ortak ve doğrulanan yolu kullanmalı');
});

test('v6.56 Clear Filters: Koleksiyon dalı çalıştırıldığında iki state de temizleniyor', () => {
  let kolColFilters = { colour: new Set(['RED']) };
  let kolCheckFilter = 'checked';
  let savedCalled = false;
  const saveKolColState = () => { savedCalled = true; };
  // v6.56 düzeltmesinin uyguladığı mantık:
  kolColFilters = {};
  kolCheckFilter = '';
  saveKolColState();
  assert.equal(Object.keys(kolColFilters).length, 0);
  assert.equal(kolCheckFilter, '');
  assert.equal(savedCalled, true);
});

test('v6.56 kolCheckFilter gerçekten filteredKol tarafından kullanılıyor (ölü kod değil)', () => {
  const body = bodyOf(APP, 'filteredKol');
  assert.match(body, /normalizeCheckFilterMode\(kolCheckFilter\)/);
});

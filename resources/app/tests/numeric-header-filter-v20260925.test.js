'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const APP = fs.readFileSync(path.join(ROOT, 'public', 'app-main.js'), 'utf8');
const INDEX = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');

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

const numeric = new Function(`
  function normalizeDecimalText(text){${bodyOf(APP, 'normalizeDecimalText')}}
  function numericFilterValue(value,col){${bodyOf(APP, 'numericFilterValue')}}
  function numericFilterRulePasses(rule,value,col){${bodyOf(APP, 'numericFilterRulePasses')}}
  return {numericFilterValue,numericFilterRulePasses};
`)();

test('sayı filtresi ham sayı ve TR/EN gösterimlerini ortak biçimde ayrıştırır', () => {
  assert.equal(numeric.numericFilterValue(65, {type:'num'}), 65);
  assert.equal(numeric.numericFilterValue('65,5', {type:'num'}), 65.5);
  assert.equal(numeric.numericFilterValue('1.234,50', {type:'money'}), 1234.5);
  assert.equal(numeric.numericFilterValue('1,234.50', {type:'money'}), 1234.5);
  assert.equal(numeric.numericFilterValue('2.364', {type:'int'}), 2364);
  assert.equal(numeric.numericFilterValue('₺ 12,75', {type:'money'}), 12.75);
  assert.equal(numeric.numericFilterValue('', {type:'num'}), null);
  assert.equal(numeric.numericFilterValue('abc', {type:'num'}), null);
});

test('eşitlik ve küçüktür/büyüktür operatörlerinin tamamı gerçek sayısal karşılaştırma yapar', () => {
  const p = (op, value, a, b, avg) => numeric.numericFilterRulePasses({op,a,b,avg}, value, {type:'num'});
  assert.equal(p('eq', 65, 65), true);
  assert.equal(p('neq', 64, 65), true);
  assert.equal(p('gt', 66, 65), true);
  assert.equal(p('gt', 65, 65), false);
  assert.equal(p('gte', 65, 65), true);
  assert.equal(p('lt', 60, 65), true);
  assert.equal(p('lt', 65, 65), false);
  assert.equal(p('lte', 65, 65), true);
  assert.equal(p('between', 65, 70, 60), true, 'ters girilen iki sınır da kapsanmalı');
  assert.equal(p('aboveAvg', 66, '', '', 65), true);
  assert.equal(p('belowAvg', 64, '', '', 65), true);
  assert.equal(p('lt', '', 65), false, 'boş hücre 0 kabul edilmemeli');
  assert.equal(p('gt', 66, ''), false, 'eksik eşik sessizce 0 olmamalı');
});

test('CP/Orders hazırlama hattı numericRule\'u boş values kümesinden önce tanır', () => {
  const make = new Function('numericFilterRulePasses', `
    const _preparedColFilterCache=new WeakMap();
    function columnByKey(tableKey,key){return {k:key,type:'num'};}
    function prepareColFilter(tableKey,key,entry){${bodyOf(APP, 'prepareColFilter')}}
    function preparedColFilterPasses(prepared,key,row){${bodyOf(APP, 'preparedColFilterPasses')}}
    return {prepareColFilter,preparedColFilterPasses};
  `)(numeric.numericFilterRulePasses);
  const entry={values:new Set(),numericRule:{op:'lt',a:'65',b:'',avg:''}};
  const prepared=make.prepareColFilter('cp','Ex→Retail',entry);
  assert.equal(prepared.kind,'numeric-rule');
  assert.equal(make.preparedColFilterPasses(prepared,'Ex→Retail',{'Ex→Retail':60}),true);
  assert.equal(make.preparedColFilterPasses(prepared,'Ex→Retail',{'Ex→Retail':65}),false);
  assert.equal(make.preparedColFilterPasses(prepared,'Ex→Retail',{'Ex→Retail':90}),false);
});

test('Excel tipi başlık override da aynı ortak sayı çekirdeğini kullanır', () => {
  const start=INDEX.indexOf('function upgradeExcelFilters(){');
  const end=INDEX.indexOf('// Antrepo Giriş Tarihi',start);
  assert.ok(start>=0&&end>start,'upgradeExcelFilters bloğu bulunmalı');
  const block=INDEX.slice(start,end);
  assert.match(block,/numericFilterRulePasses\(entry\.numericRule,numericRawValue\(col,row\),col\)/);
  assert.match(block,/base\.map\(r=>numericFilterValue\(numericRawValue\(col,r\),col\)\)/);
  assert.match(block,/numericValueKey\(numericRawValue\(col,row\),col\)/);
});

test('sayı panelindeki tüm mevcut operatörler korunuyor', () => {
  const start=INDEX.indexOf('function upgradeExcelFilters(){');
  const end=INDEX.indexOf('// Antrepo Giriş Tarihi',start);
  const block=INDEX.slice(start,end);
  for (const op of ['eq','neq','gt','gte','lt','lte','between','aboveAvg','belowAvg']) {
    assert.match(block,new RegExp(`option value=["']${op}["']`),`${op} operatörü panelde bulunmalı`);
  }
  assert.match(block,/if\(!NUM_TYPES\.has\(col\.type\)\|\|col\.type==='pct'\)\{originalOpen\(/,
    'yüzde sütunlarının özel aralık filtresi korunmalı');
});

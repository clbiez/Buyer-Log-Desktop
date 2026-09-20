'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const APP = fs.readFileSync(path.join(ROOT, 'public', 'app-main.js'), 'utf8');
const LFL = fs.readFileSync(path.join(ROOT, 'public', 'lfl.js'), 'utf8');
const OAB = fs.readFileSync(path.join(ROOT, 'public', 'oab.js'), 'utf8');

function helper(name, args) {
  const match = APP.match(new RegExp(`function ${name}\\(${args}\\)\\{[^]*?\\n\\}`));
  assert.ok(match, `${name} ortak yardımcı fonksiyonu bulunmalı`);
  return Function(`const norm=value=>String(value==null?'':value).trim(); function parseTableSearchTerms(value){ const groups=String(value==null?'':value).split(';').map(group=>group.split(',').map(part=>norm(part).toLocaleLowerCase('tr-TR')).filter(Boolean)).filter(group=>group.length); return groups.length===1?groups[0]:groups; } ${match[0]}; return ${name};`)();
}

test('arama kriterlerini trim eder, operatorü yalnız başta tanır ve boş kriterleri atar', () => {
  const parse = helper('parseTableSearchTerms', 'value');
  assert.deepEqual(parse('  /MINE,   !STUMB, , BRAW  '), [
    { mode: 'contains', value: 'mine' },
    { mode: 'notContains', value: 'stumb' },
    { mode: 'exact', value: 'braw' },
  ]);
});

test('exact, contains ve not contains operatorleri doğru eşleşir', () => {
  const parse = helper('parseTableSearchTerms', 'value');
  const matches = helper('tableSearchMatches', 'haystack,terms,options');
  assert.equal(matches('ÇAĞRI', parse('cagri')), true);
  assert.equal(matches('İSTANBUL ŞUBE', parse('istanbul')), true);
  assert.equal(matches('İSTANBUL ŞUBE', parse('/şube')), true);
  assert.equal(matches('ABC', parse('ABC')), true);
  assert.equal(matches('ZABCER ABC123', parse('ABC')), false);
  assert.equal(matches('ABC-123', parse('ABC')), true);
  assert.equal(matches('MINECRAFT-13-YD', parse('MINECRAFT')), true);
  assert.equal(matches('FORMULA-13-YI', parse('for')), false);
  assert.equal(matches('FORMULA-13-YI', parse('for'), { plainMode: 'contains' }), true);
  assert.equal(matches('ZABCER ABC123', parse('/ABC')), true);
  assert.equal(matches('ZABCER ABC123', parse('!ABC')), false);
  assert.equal(matches('anything', parse('!ABC')), true);
  assert.equal(matches('anything', parse(' , ')), true);
});

test('virgül OR, noktalı virgül AND ve yalnız boşluklu ayırıcılar olarak uygulanır', () => {
  const parse = helper('parseTableSearchTerms', 'value');
  const matches = helper('tableSearchMatches', 'haystack,terms,options');

  assert.deepEqual(parse('ABC, XYZ'), [
    { mode: 'exact', value: 'abc' },
    { mode: 'exact', value: 'xyz' },
  ]);
  assert.deepEqual(parse('ABC; XYZ'), [
    [{ mode: 'exact', value: 'abc' }],
    [{ mode: 'exact', value: 'xyz' }],
  ]);
  assert.equal(matches('ABC Z', parse('ABC; Z, /XY')), true);
  assert.equal(matches('ABC XY', parse('ABC; Z, /XY')), true);
  assert.equal(matches('ABC RED', parse('ABC; Z, /XY')), false);
  assert.equal(matches('SAL MET', parse('SAL; !MET')), false);
  assert.equal(matches('SAL BLUE', parse('SAL; !MET')), true);

  assert.deepEqual(parse('SAL; 13, MET'), [
    [{ mode: 'exact', value: 'sal' }],
    [{ mode: 'exact', value: '13' }, { mode: 'exact', value: 'met' }],
  ]);
  assert.deepEqual(parse('13,50'), [{ mode: 'exact', value: '13,50' }]);
  assert.deepEqual(parse('ABC,XYZ'), [{ mode: 'exact', value: 'abc,xyz' }]);
  assert.deepEqual(parse('ABC;XYZ'), [{ mode: 'exact', value: 'abc;xyz' }]);
  assert.deepEqual(parse('13, 50'), [
    { mode: 'exact', value: '13' },
    { mode: 'exact', value: '50' },
  ]);
  assert.deepEqual(parse('SAL;13,MET'), [{ mode: 'exact', value: 'sal;13,met' }]);
  assert.deepEqual(parse('XX,XXXX'), [{ mode: 'exact', value: 'xx,xxxx' }]);
  assert.deepEqual(parse('ABC!DEF'), [{ mode: 'exact', value: 'abc!def' }]);
  assert.deepEqual(parse('ABC/DEF'), [{ mode: 'exact', value: 'abc/def' }]);
  assert.deepEqual(parse('SAL;13,!MET'), [{ mode: 'exact', value: 'sal;13,!met' }]);
  assert.equal(matches('SAL;13,!MET', parse('SAL;13,!MET')), true);
});

test('ana tablo aramaları terimleri satır başına yeniden parse etmez', () => {
  assert.match(APP, /q:parseTableSearchTerms\(document\.getElementById\('cpSearch'\)\.value\)/);
  assert.match(APP, /q:parseTableSearchTerms\(document\.getElementById\('ordersSearch'\)\?\.value\)/);
  assert.match(APP, /const q = parseTableSearchTerms\(document\.getElementById\('kolSearch'\)\.value\)/);
  assert.match(APP, /tableSearchMatches\(hay,ctx\.q,\{plainMode:'contains'\}\)/);
  assert.match(APP, /tableSearchMatches\(kolSearchHaystack\(r\),q,\{plainMode:'contains'\}\)/);
});

test('tablo detay aramaları da ortak çoklu arama yardımcısını kullanır', () => {
  assert.match(LFL, /tableSearchMatches\(/);
  assert.match(OAB, /tableSearchMatches\(/);
});

function clipboardHelper() {
  const match = APP.match(/function parseTableSearchClipboardMatrix\(text\)\{[^]*?\n\}/);
  assert.ok(match, 'parseTableSearchClipboardMatrix ortak yardımcı fonksiyonu bulunmalı');
  return Function(`${match[0]}; return parseTableSearchClipboardMatrix;`)();
}

test('Excel pano matrisi TAB/satır sonuna göre satır-öncelikli sırayla düzleştirilir', () => {
  const parse = clipboardHelper();
  assert.deepEqual(parse('A1\tB1\r\nA2\tB2'), ['A1', 'B1', 'A2', 'B2']);
  assert.deepEqual(parse('A1\nB1'), ['A1', 'B1']);
  assert.deepEqual(parse('A1\rB1'), ['A1', 'B1']);
});

test('Excel pano matrisinde boş hücreler atılır, boşluk kırpılır, tekrar edenler ilk sıra korunarak tekilleştirilir', () => {
  const parse = clipboardHelper();
  assert.deepEqual(parse(' A1 \t B1 \nA1\t\tB2'), ['A1', 'B1', 'B2']);
  assert.deepEqual(parse('1001\t\t1002\n1001\t1003\t1002'), ['1001', '1002', '1003']);
});

test('tek değerlik pano yapıştırması tek elemanlı dizi üretir', () => {
  const parse = clipboardHelper();
  assert.deepEqual(parse('ABC123'), ['ABC123']);
});

test('pano matrisinden üretilen terimler OR olarak eşleşir', () => {
  const parse = helper('parseTableSearchTerms', 'value');
  const matches = helper('tableSearchMatches', 'haystack,terms,options');
  const clipboardParse = clipboardHelper();
  const terms = clipboardParse('10001\t10002\n10003\t10004').join(', ');
  assert.deepEqual(parse(terms), [
    { mode: 'exact', value: '10001' },
    { mode: 'exact', value: '10002' },
    { mode: 'exact', value: '10003' },
    { mode: 'exact', value: '10004' },
  ]);
  assert.equal(matches('SIPARIS 10002', parse(terms)), true);
  assert.equal(matches('SIPARIS 99999', parse(terms)), false);
});

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { resolveHeader, analyze, codeKey } = require('../scripts/merch-code-map.js');

test('merch başlıkları kanonik MAG/MMYG alanına çözülür', () => {
  for (const h of ['MAG', 'Merch Alt Grup Kod', 'Merch Alt Grup', 'merch alt grup kod']) assert.equal(resolveHeader(h).field, 'mag', h);
  for (const h of ['MMYG', 'Merch Marka Yaş Grup Kod', 'Merch Marka Yas Grup Kod']) assert.equal(resolveHeader(h).field, 'mmyg', h);
  assert.deepEqual([resolveHeader('Merch Alt Grup Tanım').field, resolveHeader('Merch Alt Grup Tanım').kind], ['mag', 'name']);
  const base = resolveHeader('Merch Marka Yaş Grup');
  assert.deepEqual([base.field, base.kind], ['mmyg', 'base']);
  assert.equal(resolveHeader('Rastgele Başlık').field, null);
});

test('dosya analizi kod→başlık, ad ve üst MMYG eşlemesini çıkarır, çakışmayı raporlar', () => {
  const headers = ['MAG', 'Merch Alt Grup Kod', 'Merch Alt Grup Tanım', 'Merch Marka Yaş Grup Kod', 'Merch Marka Yaş Grup'];
  const rows = [
    ['CU4E', 'CU4E', 'Kazak', 'CKW1', 'Kids Kız'],
    [' cu4e ', 'CU4E', 'Kazak', 'CKW1', 'Kids Kız'],
    ['CU4E', 'CU4X', 'Kazak Uzun', 'CKW2', 'Kids Erkek'],
  ];
  const res = analyze({ headers, rows }, {});
  const mag = res.codes.find(c => c.field === 'mag' && c.code === 'CU4E');
  assert.equal(mag.rows, 5);
  assert.deepEqual([...mag.headers].sort(), ['MAG', 'Merch Alt Grup Kod']);
  assert.deepEqual([...mag.parents].sort(), ['CKW1', 'CKW2']);
  const mmyg = res.codes.find(c => c.field === 'mmyg' && c.code === 'CKW1');
  assert.deepEqual([...mmyg.names], ['Kids Kız']);
  assert.equal(res.columns.find(c => c.header === 'Merch Marka Yaş Grup').kind, 'name');
  assert.ok(res.conflicts.some(c => /MAG/.test(c.detail) && /CU4E ≠ CU4X|CU4X ≠ CU4E/.test(c.detail)));
  assert.ok(res.conflicts.some(c => /CU4E/.test(c.detail) && /MMYG/.test(c.type)));
  assert.equal(codeKey('123.0'), '123');
});

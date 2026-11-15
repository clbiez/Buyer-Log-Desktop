'use strict';

/* INTAKE pivotu OAB gibi görünür: açılan grubun detay satırında üst kademe
   boyut hücreleri boştur, yalnız en alt kademe kendi sütununda yazılır. */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'public', 'intake.js'), 'utf8');

function fnSource(name) {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start > 0, `${name} yok`);
  let depth = 0, i = source.indexOf('{', start);
  for (; i < source.length; i++) { if (source[i] === '{') depth++; else if (source[i] === '}' && --depth === 0) break; }
  return source.slice(start, i + 1);
}

function cellHtml(rows, item, field) {
  const ctx = {
    rowsCfg: rows, text: (tr) => tr, esc: v => String(v == null ? '' : v), clean: v => String(v == null ? '' : v).trim(),
    numberText: v => String(v),
  };
  vm.createContext(ctx);
  vm.runInContext(`const query=()=>({rows:rowsCfg,columns:[],measures:[]});const display=()=>({grouped:true});${fnSource('intakeCellHtml')};this.fn=intakeCellHtml;`, ctx);
  return ctx.fn(item, field);
}

const rows = [{ id: 'sezon', fieldType: 'dimension' }, { id: 'donem', fieldType: 'dimension' }, { id: 'klasman', fieldType: 'dimension' }];
const leaf = { kind: 'leaf', level: 2, row: { sezon: 'S7', donem: 'Ocakta Başlayanlar', klasman: 'KEY ORME BODY' } };

test('detay satırında üst kademe boyutları boş, en alt kademe yazılı', () => {
  assert.equal(cellHtml(rows, leaf, rows[0]), '<td class=""></td>');
  assert.equal(cellHtml(rows, leaf, rows[1]), '<td class=""></td>');
  assert.match(cellHtml(rows, leaf, rows[2]), /KEY ORME BODY/);
});

test('grup etiketi OAB gibi girinti padding’i olmadan kendi sütununda tam metinle yazılır', () => {
  const group = { kind: 'group', level: 1, pathKey: 'k', collapsed: false, subtotal: true, row: { donem: 'Ocakta Başlayanlar' } };
  const html = cellHtml(rows, group, rows[1]);
  assert.doesNotMatch(html, /padding-left/);
  assert.match(html, /title="Ocakta Başlayanlar"/);
  assert.match(html, /colspan="2"/, 'etiket boş alt kademe hücresini kaplar');
  assert.equal(cellHtml(rows, group, rows[2]), '', 'kaplanan hücre ayrıca çizilmez');
  assert.equal(cellHtml(rows, group, rows[0]), '<td></td>');
});

test('gruplama kapalıyken düz tablo tüm boyutları gösterir', () => {
  assert.match(source, /display\(\)\.grouped !== false && rowIndex >= 0 && rowIndex < item\.level/);
});

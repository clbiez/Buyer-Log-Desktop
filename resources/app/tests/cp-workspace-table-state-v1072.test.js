'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const APP = fs.readFileSync(path.join(ROOT, 'public', 'app-main.js'), 'utf8');

function bodyOf(name) {
  const start = APP.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `${name} bulunmalı`);
  const open = APP.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < APP.length; i++) {
    if (APP[i] === '{') depth++;
    else if (APP[i] === '}' && --depth === 0) return APP.slice(open + 1, i);
  }
  throw new Error(`${name} ayrıştırılamadı`);
}

test('v10.72 CP Focus ve All görünürlük presetleri gerçek sütun durumuna bağlıdır', () => {
  const start = APP.indexOf('const TABLE_VIEW_PRESETS');
  const end = APP.indexOf('const TABLE_VIEW_FOCUS_KEY', start);
  const presets = APP.slice(start, end);
  assert.match(presets, /cp:Object\.freeze\(\{focus:Object\.freeze\(\[/,
    'CP için Focus preset tanımlı olmalı');
  assert.match(presets, /__picture|Priority|Manufacturer|Model Name/,
    'CP Focus gerçek CP sütunlarından oluşmalı');
  assert.match(bodyOf('applyTableViewPreset'), /TABLE_VIEW_PRESETS\[tableKey\]/,
    'Focus ve All aynı görünürlük state yolunu kullanmalı');
  assert.match(APP, /document\.addEventListener\('click',event=>\{[\s\S]*?applyTableViewPreset\(/,
    'preset butonları command handler’a bağlı olmalı');
});

test('v10.72 CP Table Filters chip silme sonrası CP tablosunu yeniden hesaplar', () => {
  const body = bodyOf('removeActiveFilterToken');
  assert.match(body, /if\(tableKey==='cp'\)renderCP\(\)/,
    'CP filtresi silinince gerçek tablo render edilmeli');
  assert.match(body, /state\.colFilters\[tableKey\]\[key\]/,
    'yalnız seçilen column filter state’ten çıkarılmalı');
});

test('v10.72 otomatik DTR Sub Mfr display, filter, copy ve export için kanoniktir', () => {
  assert.match(APP, /function cpSubManufacturerValue\(r\)/,
    'Sub Mfr için tek kanonik accessor olmalı');
  const cellHtml = bodyOf('cellHtml');
  assert.match(cellHtml, /case 'submfr':[\s\S]*?cpSubManufacturerValue\(r\)/,
    'CP hücresi kanonik Sub Mfr accessor’ını kullanmalı');
  const plainText = bodyOf('cellPlainText');
  assert.match(plainText, /c\.k==='Sub-Manufacturer'[\s\S]*?cpSubManufacturerValue\(r\)/,
    'filter/copy/export metni aynı accessor’ı kullanmalı');
});

test('v10.72 Collection freeze offsetleri colgroup stilinden değil gerçek layout genişliğinden hesaplanır', () => {
  const engine = fs.readFileSync(path.join(__dirname, '..', 'public', 'table-freeze.js'), 'utf8');
  assert.match(engine, /cells\.map\(function \(cell\) \{ return cell\.getBoundingClientRect\(\)\.width; \}\)/,
    'sticky offset gerçek başlık hücresi ölçüsünü kullanmalı');
  assert.match(engine, /new global\.ResizeObserver/, 'genişlik değişince ofsetler yeniden yazılmalı');
  assert.doesNotMatch(engine, /colgroup/, 'colgroup stil genişliği ofset kaynağı olmamalı');
  assert.match(bodyOf('applyFreeze'), /BLTableFreeze\.apply\(table,\{count:getFreeze\(tableKey\)\.left\}\)/);
  for (const legacy of ['freezeColumnWidths', 'freezeLayoutFor', 'applyFreezeToRow', 'applyFreezePlanToRow'])
    assert.doesNotMatch(APP, new RegExp('function ' + legacy + '\\('), legacy + ' yeniden eklenmemeli');
});

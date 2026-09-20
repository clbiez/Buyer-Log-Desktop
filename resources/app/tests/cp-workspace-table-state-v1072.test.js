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
  assert.match(APP, /function freezeColumnWidths\(table,withChk\)/,
    'freeze için tek genişlik ölçüm yardımcısı olmalı');
  const helperStart = APP.indexOf('function freezeColumnWidths(');
  const helperEnd = APP.indexOf('\n}', helperStart) + 2;
  const helper = APP.slice(helperStart, helperEnd);
  assert.match(helper, /getBoundingClientRect\(\)\.width/,
    'sticky offset gerçek header/body layout ölçüsünü kullanmalı');
  assert.match(bodyOf('applyFreeze'), /freezeColumnWidths\(table,withChk\)/);
  assert.match(bodyOf('freezeLayoutFor'), /freezeColumnWidths\(table,withChk\)/);
  assert.match(bodyOf('applyFreezeToRow'), /freezeColumnWidths\(table,withChk\)/);
});

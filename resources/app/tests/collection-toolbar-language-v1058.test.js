'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', 'public');
const HTML = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const APP = fs.readFileSync(path.join(ROOT, 'app-main.js'), 'utf8');
const escapeRegex = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

test('v10.58 Collection araç çubuğu başlangıç başlıklarını ve görünür metnini seçili dile çevirir', () => {
  for (const [id, englishTitle] of [
    ['kolUndoBtn', 'Undo (Ctrl+Z)'],
    ['kolRedoBtn', 'Redo (Ctrl+Y)'],
    ['kolExportImgBtn', 'Export to Excel with model images'],
    ['kolDuplicateBtn', 'Duplicate selected rows in Collection'],
  ]) {
    assert.match(HTML, new RegExp(`id="${id}"[^>]*data-i18n-title-en="${escapeRegex(englishTitle)}"`));
  }

  assert.match(HTML, /id="kolUndoBtn"[\s\S]*?<span data-i18n-tr="Geri" data-i18n-en="Undo">Geri<\/span>/);
  assert.match(HTML, /id="kolRedoBtn"[\s\S]*?<span data-i18n-tr="İleri" data-i18n-en="Redo">İleri<\/span>/);
});

test('v10.58 Collection seçime bağlı araç ipuçları İngilizce görünümde Türkçe kalmaz', () => {
  const start = APP.indexOf('const copyBtn=document.getElementById(\'kolCopySelectedBtn\')');
  const end = APP.indexOf('// ctx ile çağrıldığında modal', start);
  const source = APP.slice(start, end);

  assert.match(source, /Copy \$\{kolSelected\.size\} selected row\(s\) with headers and formatting/);
  assert.match(source, /Duplicate \$\{validSelectionCount\} selected row\(s\)/);
  assert.match(source, /\$\{validSelectionCount\} \$\{appLang==='en'\?'selected model\(s\) will be deleted':'seçili model silinecek'\}/);
  assert.match(source, /Select at least one model first/);
});

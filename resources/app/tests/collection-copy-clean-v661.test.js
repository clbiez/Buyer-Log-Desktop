'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const APP = fs.readFileSync(path.join(__dirname, '..', 'public', 'app-main.js'), 'utf8');

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

test('Koleksiyon Model Name hücresi panoya yalnız model adını verir, PLM ↗ simgesini vermez', () => {
  assert.match(APP, /plmModelLinkCell"\$\{rc\} data-copy-text="\$\{escapeHtml\(cur\)\}"/);
});

test('Genel hücre kopyalama UI buton/ikonlarını metinden temizler', () => {
  const body = bodyOf('_copyMeaningfulCellText');
  assert.match(body, /querySelectorAll\('button,svg,\.ic,\.plmBridgeIcon,\[data-copy-ui-only\]'\)/);
  const copyBody = bodyOf('_copyCellFromTd');
  assert.match(copyBody, /const ctl = td\.querySelector\('select,input,textarea'\)/);
  assert.match(copyBody, /else text = _copyMeaningfulCellText\(td\);/);
});

test('TR Landed HTML clipboard görünümünde dolar işaretini de taşır', () => {
  const body = bodyOf('_copyCellFromTd');
  assert.match(body, /td\.dataset\.copyNumfmt==='money2'\?escapeHtml\(copyText\):''/);
  assert.match(APP, /const _COPY_NUMFMT = \{ money2: "\\\\\$#,##0\.00" \}/);
});

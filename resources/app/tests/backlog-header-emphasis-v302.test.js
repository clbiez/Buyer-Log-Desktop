'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const JSZip = require('../public/vendor/jszip.min.js');
const backlog = require('../public/backlog-excel-formulas.js');

const ROOT = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'public/index.html'), 'utf8');

function tags(xml, name) {
  const block = xml.match(new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)<\\/${name}>`))?.[1] || '';
  const child = name === 'cellXfs' ? 'xf' : name.slice(0, -1);
  return block.match(new RegExp(`<${child}\\b[^>]*/>|<${child}\\b[^>]*>[\\s\\S]*?<\\/${child}>`, 'g')) || [];
}

function styleId(sheet, ref) {
  const cell = sheet.match(new RegExp(`<c\\b(?=[^>]*\\br="${ref}")(?=[^>]*\\bs="(\\d+)")[^>]*>`));
  assert.ok(cell, `Cell ${ref} with style was not found`);
  return Number(cell[1]);
}

function attr(xml, name) {
  return Number(xml.match(new RegExp(`\\b${name}="(\\d+)"`))?.[1]);
}

// v3.18 (version-history.js): "yalnız veri kalın" kuralı (v3.02) tersine döndü — tüm
// Backlog başlıkları, vurgulu ikisi dahil, artık kalın. Fiziksel şablon (BACKLOG.xlsx)
// da bununla tutarlı (J1/L1 hücrelerinde <b/> doğrulandı) — sadece bu test eski kuralda.
test('browser Backlog styles the two requested headers yellow; all headers including emphasis are bold', () => {
  assert.deepEqual(backlog.headerStyleSpec('Sipariş Kod'), { fillRgb: 'FFFFF2CC', fontRgb: 'FF665200', bold: true });
  assert.deepEqual(backlog.headerStyleSpec('Model Adı'), { fillRgb: 'FFFFF2CC', fontRgb: 'FF665200', bold: true });
  assert.deepEqual(backlog.headerStyleSpec('Buyer'), { fillRgb: 'FFF2F4F7', fontRgb: 'FF475467', bold: true });
  const appMain = fs.readFileSync(path.join(ROOT, 'public/app-main.js'), 'utf8');
  assert.match(appMain, /const headerStyle=BLBacklogExcel\.headerStyleSpec\(h\)/);
  assert.match(appMain, /font:\{sz:10,bold:headerStyle\.bold,color:\{rgb:headerStyle\.fontRgb\}\}/);
});

test('server Backlog template has yellow Order Code and Model Name headers (bold, matching all other headers)', async () => {
  const raw = fs.readFileSync(path.join(ROOT, 'server/templates/BACKLOG.xlsx'));
  const zip = await JSZip.loadAsync(raw);
  const sheet = await zip.file('xl/worksheets/sheet1.xml').async('string');
  const styles = await zip.file('xl/styles.xml').async('string');
  const xfs = tags(styles, 'cellXfs');
  const fonts = tags(styles, 'fonts');
  const fills = tags(styles, 'fills');

  const yellowHeaderRefs = ['J1', 'L1'];
  for (const ref of yellowHeaderRefs) {
    const xf = xfs[styleId(sheet, ref)];
    const font = fonts[attr(xf, 'fontId')];
    const fill = fills[attr(xf, 'fillId')];
    assert.match(fill, /rgb="FFFFF2CC"/);
    assert.match(font, /<b\b/);
  }

  for (const ref of ['A1', 'B1', 'G1', 'H1', 'I1', 'K1', 'M1', 'AD1']) {
    const xf = xfs[styleId(sheet, ref)];
    const font = fonts[attr(xf, 'fontId')];
    const fill = fills[attr(xf, 'fillId')];
    assert.doesNotMatch(fill, /rgb="FFFFF2CC"/);
    assert.match(font, /<b\b/);
  }

  for (const ref of ['J2', 'L2']) {
    const xf = xfs[styleId(sheet, ref)];
    const font = fonts[attr(xf, 'fontId')];
    assert.match(font, /<b\b/);
  }
});

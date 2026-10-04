'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const APP = fs.readFileSync(path.join(ROOT, 'public', 'app-main.js'), 'utf8');
const CSS = fs.readFileSync(path.join(ROOT, 'public', 'app.css'), 'utf8');

function functionSource(name) {
  const start = APP.indexOf(`function ${name}`);
  assert.ok(start >= 0, `${name} bulunmalı`);
  const next = APP.indexOf('\nfunction ', start + 10);
  return APP.slice(start, next < 0 ? APP.length : next);
}

test('CP lojistik alt detayında sipariş tarihleri Handover öncesinde, Antrepo tarihi en sağda gösterilir', () => {
  const src = functionSource('cpLogisticDetailRowHtml');

  assert.match(src, /const exFactory=coerceDateLoose\(row&&row\['Ex-factory'\]\);/);
  assert.match(src, /const loadingApproval=coerceDateLoose\(row&&row\['Buying Son Onay Tarihi'\]\);/);

  const bodyOrder = [
    'transitDelTypeDisplay(segment.delType)',
    'fmtDate(exFactory)',
    'fmtDate(loadingApproval)',
    'fmtDate(handover)',
    'fmtDate(arrival)',
  ].map(token => src.indexOf(token));
  assert.ok(bodyOrder.every(i => i >= 0), 'tüm lojistik detay değerleri çizilmeli');
  assert.deepEqual([...bodyOrder].sort((a, b) => a - b), bodyOrder, 'Vasıta → Ex-Factory → Yükleme Onayı → Handover → Antrepo sırası korunmalı');

  const headerOrder = [
    "'Vehicle':'Vasıta'",
    "'Ex-Factory Date':'Ex-Factory Tarihi'",
    "'Loading Approval Date':'Yükleme Onay Tarihi'",
    '<span>Handover</span>',
    "'Warehouse ETA':'Antrepo tarihi'",
  ].map(token => src.indexOf(token));
  assert.ok(headerOrder.every(i => i >= 0), 'tüm yeni başlıklar bulunmalı');
  assert.deepEqual([...headerOrder].sort((a, b) => a - b), headerOrder, 'başlık sırası veri sırasıyla aynı olmalı');
});

test('CP lojistik alt detay gridinde dokuz sütun için yeterli yatay alan ayrılır', () => {
  const marker = '.cpLogisticDetailGridHead,.cpLogisticDetailLine{display:grid;grid-template-columns:';
  const start = CSS.indexOf(marker);
  assert.ok(start >= 0, 'lojistik grid kuralı bulunmalı');
  const rule = CSS.slice(start, CSS.indexOf('}', start) + 1);
  assert.equal((rule.match(/minmax\(/g) || []).length, 9);
  assert.match(CSS, /\.cpLogisticDetailHead,\.cpLogisticDetailGridHead,\.cpLogisticDetailBody\{min-width:1120px;\}/);
});

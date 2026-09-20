'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
// Uygulama çekirdeği index.html'den public/app-main.js'e taşındı; sınanan
// özellik (KOL_CONFIRMED_NAME_FILTER_KEY) yaşıyor, test yanlış dosyaya bakıyordu.
const html = fs.readFileSync(path.join(root, 'public', 'app-main.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'public', 'app.css'), 'utf8');

test('Collection Conf. Manufacturer exposes a working synthetic value filter', () => {
  assert.match(html, /const KOL_CONFIRMED_NAME_FILTER_KEY = '__confirmedName__'/);
  assert.match(html, /if\(key===KOL_CONFIRMED_NAME_FILTER_KEY\)[\s\S]*kolConfirmedPricing\(row\)/);
  assert.match(html, /if\(d\.kind==='confirmedName'\)[\s\S]*kolSyntheticFilterBtn/);
  assert.match(html, /openKolHeaderFilter\(btn\.dataset\.kolFilter,e\.currentTarget\)/);
  assert.match(html, /const meta = kolFilterMeta\(key\)/);
  assert.match(html, /set\.has\(kolFilterValue\(r,k\)\)/);
});

// Mekanizma değişti, niyet değişmedi: kolFilterValue artık kolConfirmedPricing'i
// DOĞRUDAN değil, kolConfirmedDisplay üzerinden çağırıyor — bu, onaylı fiyat yoksa
// en iyi teklife (kolBestPricing) düşen bir sarmalayıcı (app-main.js:17362-17367).
// Yani filtre artık eskisinden de DAHA ÇOK "ekranda görünen" değeri yansıtıyor.
test('Conf. Manufacturer filtering uses the displayed effective approval, not stale raw row data', () => {
  const accessorStart = html.indexOf('function kolFilterValue(row,key){');
  const accessorEnd = html.indexOf('function kolFilterMeta(key){', accessorStart);
  const accessor = html.slice(accessorStart, accessorEnd);
  assert.match(accessor, /const display=kolConfirmedDisplay\(row\)/);
  assert.match(accessor, /return display\?norm\(display\.name\):''/);
  assert.doesNotMatch(accessor, /row\.confirmedManufacturer/);
});

test('Buying Sample approval colours only the tick, not the whole cell', () => {
  assert.match(css, /#kolTable \.kolBuyingSampleApprove\[aria-pressed="true"\][^{]*\{[^}]*background:var\(--green-lite,var\(--green\)\)/s);
  assert.doesNotMatch(css, /#kolTable td\.kolBuyingSampleTd\.isApproved\s*\{/);
  assert.match(html, /kolBuyingSampleTd\$\{approved\?' isApproved':''\}/);
});

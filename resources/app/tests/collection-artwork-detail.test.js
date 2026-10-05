'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(ROOT, file), 'utf8');
const INDEX = read('public/index.html');
const COLUMN = read('public/collection-artwork-detail.js');
const ROUTE = read('server/routes/plm-sync-routes.js');

test('Collection loads Artwork Detail projection after app-main and before spreadsheet wiring', () => {
  const app = INDEX.indexOf('app-main.js');
  const artwork = INDEX.indexOf('collection-artwork-detail.js');
  const spreadsheet = INDEX.indexOf('collection-spreadsheet.js');
  assert.ok(app >= 0 && artwork > app, 'Artwork projection must load after Collection core');
  assert.ok(spreadsheet > artwork, 'Artwork projection must exist before spreadsheet initializes');
});

test('Artwork Detail is a read-only Model Details system projection immediately before Fabric', () => {
  assert.match(COLUMN, /const ART_KEY = 'artworkDetail'/);
  assert.match(COLUMN, /const FABRIC_KEY = 'fabric'/);
  assert.match(COLUMN, /group: 'Model Detayları'/);
  assert.match(COLUMN, /editable: false/);
  assert.match(COLUMN, /readonly: true/);
  assert.match(COLUMN, /findIndex\(th => headerKey\(th\) === FABRIC_KEY\)/);
  assert.match(COLUMN, /colRow\.insertBefore\(artHead, fabric\)/);
  assert.match(COLUMN, /tr\.insertBefore\(makeCell\(\), tr\.cells\[index\] \|\| null\)/);
  assert.match(COLUMN, /Artwork Detayı/);
});

test('Artwork Detail remains PLM-owned: persistent source is BOM sidecar, not Collection row save', () => {
  assert.match(COLUMN, /plm-bom\.json/);
  assert.match(COLUMN, /\/api\/plm-sync\/bom\/batch/);
  assert.doesNotMatch(COLUMN, /saveKolRows\s*\(/, 'PLM-owned artwork data must not create a second Collection source of truth');
  assert.match(COLUMN, /row\[ART_KEY\] = summary/, 'visible row may receive an in-memory projection for clipboard/runtime consumers');
});

test('Artwork Detail keeps grouped header/spreadsheet geometry aligned', () => {
  assert.match(COLUMN, /patchGroupRow\(table, at\)/);
  assert.match(COLUMN, /th\.colSpan = span \+ 1/);
  assert.match(COLUMN, /BLCollectionSpreadsheet\.afterRender/);
  assert.match(COLUMN, /data-key/);
});

test('visible Collection models read BOM summaries with one local batch request', () => {
  assert.match(ROUTE, /app\.post\('\/api\/plm-sync\/bom\/batch'/);
  assert.match(ROUTE, /plmBomStore\.load\(\)/);
  assert.match(ROUTE, /entries\[plmId\] = entry/);
  const batch = ROUTE.slice(ROUTE.indexOf("app.post('/api/plm-sync/bom/batch'"), ROUTE.indexOf("app.get('/api/plm-sync/bom/:plmId'"));
  assert.doesNotMatch(batch, /syncPlmBoms\s*\(|coreNectumApiClient\.|getDefaultEngine\s*\(|\.ask\s*\(/,
    'batch projection must not trigger remote PLM/AI work');
});

test('Artwork cell can open the full BOM detail view on double click', () => {
  assert.match(COLUMN, /addEventListener\('dblclick'/);
  assert.match(COLUMN, /_loadScript\('plm-bom\.js'\)/);
  assert.match(COLUMN, /BLPlmBom\.openForRow/);
});

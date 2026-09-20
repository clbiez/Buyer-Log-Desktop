'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { buildOverviewSummaryRowsFromASAS } = require('../server/lib/parse');

const ROOT = path.join(__dirname, '..');

test('v5.32 startup overview projection keeps only dashboard fields', () => {
  const rows = buildOverviewSummaryRowsFromASAS([{
    kalan: 12, merch: 'MAG-1', ageGroup: 'MMYG-1', buyerGrup: 'ÖRME', buyer: 'Buyer A',
    season: 'W6', countryRaw: 'Türkiye', manufacturer: 'Factory A', license: 'Marvel',
    category: 'T-Shirt', line: 'Licensed', fob: 4.567, qty: 100, ocode: 12345,
  }], { licensormap: {}, submap: {} });

  assert.equal(rows.length, 1);
  assert.equal(rows[0]['Active/Inactive'], 'Active');
  assert.equal(rows[0]['Order Quantity'], 100);
  assert.equal(rows[0].Remaining, 12);
  assert.equal(rows[0]['FOB ($)'], 4.57);
  assert.equal(rows[0].Licensor, 'DTR');
  assert.ok(!Object.hasOwn(rows[0], 'Priority'), 'startup projection must not run full priority formulas');
  assert.ok(!Object.hasOwn(rows[0], 'STATUS'), 'startup projection must not run warehouse status matching');
});

test('v5.32 startup API omits full Orders and exposes an on-demand endpoint', () => {
  const server = fs.readFileSync(path.join(ROOT, 'server', 'server.js'), 'utf8');
  assert.match(server, /startup:\s*String\(req\.query\.mode \|\| ''\) === 'initial'/);
  assert.match(server, /orders = startup \? null/);
  assert.match(server, /orderSummary = startup \? null/);
  assert.match(server, /app\.get\('\/api\/data\/orders'/);
});

test('v5.32 client requests lean startup data and loads heavy pages on first use', () => {
  const appMain = fs.readFileSync(path.join(ROOT, 'public', 'app-main.js'), 'utf8');
  // v7.15: hafif yanıt artık yalnız ilk açılışta değil, ayar kaydı / Excel yükleme /
  // paylaşılan revision bildirimi sonrasındaki yeniden yüklemelerde de kullanılıyor.
  // İddianın niyeti (istemci hafif açılış verisi ister) korunuyor, kapsamı genişledi.
  assert.match(appMain, /\(initialScreenLoad\|\|leanReload\)\?'\/api\/data\?mode=initial':'\/api\/data'/);
  assert.match(appMain, /const leanReload=!force&&!initialScreenLoad;/);
  assert.match(appMain, /fetch\('\/api\/data\/orders'/);
  assert.match(appMain, /tab==='orders'&&!state\.orders/);
  assert.match(appMain, /tab==='backlog'.*!backlogLoadedOnce/);
  assert.match(appMain, /currentActiveTab\(\)==='backlog'/);
});

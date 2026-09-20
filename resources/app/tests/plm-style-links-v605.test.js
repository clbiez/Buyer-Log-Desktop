'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const APP = fs.readFileSync(path.join(__dirname, '..', 'public', 'app-main.js'), 'utf8');
const INDEX = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
const SERVER = fs.readFileSync(path.join(__dirname, '..', 'server', 'server.js'), 'utf8');

function freshStore(root) {
  process.env.BUYER_LOG_SERVER_DATA_ROOT = root;
  for (const name of ['../server/user-data', '../server/lib/plm-style-links']) {
    delete require.cache[require.resolve(name)];
  }
  return require('../server/lib/plm-style-links');
}

test('CoreNectum style URL is built from the internal styleId, not the PLM Code', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'buyerlog-plm-links-'));
  const store = freshStore(root);
  assert.equal(store.normalizeNumericId('2.108.736'), '2108736');
  assert.equal(store.normalizeNumericId('_2468230'), '2468230');
  assert.equal(
    store.styleUrl(2468230),
    'https://corenectum.lcwaikiki.com/models-options/style-overview?styleId=2468230&m=2'
  );
  assert.equal(store.styleUrl('not-an-id'), '');
});

test('PLM link imports are persistent, deduplicated by PLM Code and safely merged', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'buyerlog-plm-links-'));
  const store = freshStore(root);
  const actor = { id: 'u1', displayName: 'Buyer' };
  const first = store.upsertPlmStyleLinks([
    { plmId: 2108736, styleId: 2468230, styleName: 'LIVERPOOL-4-YI', specialCode: 'S7OT04Z4' },
    { plmId: 'invalid', styleId: 1 },
  ], actor);
  assert.equal(first.added, 1);
  assert.equal(first.invalid, 1);
  assert.equal(first.count, 1);

  const second = store.upsertPlmStyleLinks([
    { plmId: 2108736, styleId: 2469000, styleName: 'LIVERPOOL-4-YI', specialCode: 'S7OT04Z4' },
    { plmId: 2108731, styleId: 2468225, styleName: 'LIVERPOOL-3-YD' },
  ], actor);
  assert.equal(second.added, 1);
  assert.equal(second.updated, 1);
  assert.equal(second.count, 2);
  const persisted = store.publicLinks(store.loadPlmStyleLinks());
  assert.equal(persisted.links.find(item => item.plmId === '2108736').styleId, '2469000');
});

test('only Model Name exposes one-click PLM bridges while PLM ID remains plain', () => {
  assert.match(APP, /case 'plm': return `<td class="num">\$\{escapeHtml\(fmtOC\(v\)\)\}<\/td>`/);
  assert.doesNotMatch(APP, /function plmLinkHtml/);
  assert.doesNotMatch(APP, /c\.k==='plmId'[\s\S]{0,500}?plmBridgeIcon/);
  assert.match(APP, /target="_blank" rel="noopener noreferrer"/);
  assert.doesNotMatch(APP, /styleId=_\$\{styleId\}/);
  assert.match(APP, /case 'modelLink':/);
  assert.match(APP, /plmStyleLinksByModel/);
  assert.match(APP, /enhanceModelNameCells/);
  assert.match(APP, /\/api\/plm-style-links\/import/);
  assert.match(APP, /\/api\/plm-style-links\/sync/);
  /* v7.81 — plmLinksImportBtn kullanıcı talebiyle kaldırıldı (Koleksiyon
     İçe/Dışa Aktar sekmesi kapatılırken); link alma zaten PLM Sync'in
     bir adımı, bu düğme ayrı bir yedek yoldu. */
  // Link alma artık ayrı bir düğme değil, PLM Sync komutlarının bir adımı.
  assert.match(INDEX, /id="cpPlmSyncBtn"/);
  assert.match(INDEX, /id="ordersPlmSyncBtn"/);
  assert.match(INDEX, /id="kolPlmSyncBtn"/);
  assert.match(SERVER, /app\.get\('\/api\/plm-style-links'/);
  assert.match(SERVER, /app\.post\('\/api\/plm-style-links\/import'/);
  assert.match(SERVER, /app\.post\('\/api\/plm-style-links\/sync'/);
});

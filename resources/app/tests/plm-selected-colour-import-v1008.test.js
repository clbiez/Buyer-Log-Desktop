'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const app = read('public/app-main.js');
const index = read('public/index.html');
const server = read('server/server.js');
const connector = require('../server/lib/agent-browser-connector');
const colourUtils = require('../public/plm-colour-utils.js');

test('direct PLM kaydı colors dizisini ayrı Buyer Log satırlarına açar', () => {
  const records = colourUtils.expandDirectRecords([{
    plmId: '2120798',
    styleName: 'MAGIX-YI',
    colors: [
      { name: 'BLACK', colorCode: 'Q6K' },
      { name: 'NAVY', colorCode: 'Q2K' },
    ],
  }]);
  assert.deepEqual(records.map(row => [row.plmId, row.colourCode, row.colour]), [
    ['2120798', 'Q6K', 'BLACK'],
    ['2120798', 'Q2K', 'NAVY'],
  ]);
});

test('CoreNectum Style List parser colors bilgisi varsa bunu kaybetmez', () => {
  const rows = connector.coreNectumStyleListRows({ data: { coreNectumResultData: { styleListResult: [{
    styleId: 300, plmCode: 200, styleName: 'MODEL-A', specialCode: 'S7X',
    colors: [{ id: 1, name: 'BLACK', colorCode: 'Q6K', hexCode: '#111111' }],
  }] } } });
  assert.deepEqual(rows[0].colors, [{ id: 1, name: 'BLACK', colorCode: 'Q6K', hexCode: '#111111' }]);
});

test('PLM selected import unified Collection PLM Sync modalında görünür ve selectedOnly isteği gönderir', () => {
  assert.match(index, /id="kolPlmSyncBtn"/);
  assert.match(app, /id:'import-selected'[\s\S]*?PLM'de Seçili Olan Modelleri Buyer Log'a Aktar/);
  assert.match(app, /runPlmSelectedImportV10/);
  assert.match(app, /selectedOnly:true/);
  assert.match(server, /selectedOnly/);
  assert.match(server, /collectCoreNectumStyleLinks/);
});

test('CoreNectum connector mevcut Style List DOM seçimlerini okuyabilen ayrı yolu içerir', () => {
  const connectorSource = read('server/lib/agent-browser-connector.js');
  assert.match(connectorSource, /coreNectumSelectedStyleRows/);
  assert.match(connectorSource, /input\[type="checkbox"\]:checked/);
  assert.match(connectorSource, /selectedOnly/);
});

test('CoreNectum seçili satır okuyucusu yalnız işaretli PLM satırlarını döndürür', async () => {
  const evaluated = [];
  const page = { _evaluateValue: async expression => {
    evaluated.push(expression);
    return [{ plmId: '2120798', styleName: 'MAGIX-YI', specialCode: 'S7X' }];
  } };
  assert.deepEqual(await connector.coreNectumSelectedStyleRows(page), [
    { plmId: '2120798', styleName: 'MAGIX-YI', specialCode: 'S7X' },
  ]);
  assert.match(evaluated[0], /input\[type="checkbox"\]:checked/);
  assert.match(evaluated[0], /data-column-id/);
});

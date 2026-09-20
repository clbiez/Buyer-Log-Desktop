'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const connector = require('../server/lib/agent-browser-connector');

test('PLM Colors hover kaynağı API rengi eksikse tamamlayıcı renkleri korur', () => {
  assert.deepEqual(connector.coreNectumMergeColourVariants([
    { name: 'BLACK', colorCode: 'Q6K' },
  ], [
    { name: 'BLACK', colorCode: 'Q6K' },
    { name: 'NAVY PRINTED', colorCode: 'LSJ', pantone: '' },
  ]), [
    { name: 'BLACK', colorCode: 'Q6K' },
    { name: 'NAVY PRINTED', colorCode: 'LSJ', pantone: '' },
  ]);
});

test('seçili PLM satır okuyucusu Colors hover popup metnini okur', async () => {
  const evaluated = [];
  const page = { _evaluateValue: async expression => {
    evaluated.push(expression);
    return [{
      plmId: '2120798', styleName: 'MAGIX-YI', specialCode: 'S7X',
      colors: [{ name: 'NAVY PRINTED', colorCode: 'LSJ', pantone: '' }],
    }];
  } };
  const rows = await connector.coreNectumSelectedStyleRows(page);
  assert.deepEqual(rows[0].colors, [{ name: 'NAVY PRINTED', colorCode: 'LSJ', pantone: '' }]);
  assert.match(evaluated[0], /color-dots__hoverTarget/);
  assert.match(evaluated[0], /color-popover-menu/);
  assert.match(evaluated[0], /Color Name/);
  assert.match(evaluated[0], /Color Code/);
});

test('PLM Sync sonucu hover renklerini API renkleriyle birleştirir', () => {
  const source = read('server/lib/agent-browser-connector.js');
  assert.match(source, /coreNectumMergeColourVariants/);
  assert.match(source, /requested\.colors/);
  assert.match(source, /color-popover-menu/);
});

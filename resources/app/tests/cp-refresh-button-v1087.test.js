'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = file => fs.readFileSync(path.join(__dirname, '..', 'public', file), 'utf8');
const APP = read('app-main.js');
const HTML = read('index.html');

test('Orders ve CP araç çubuklarında arama ve tablo eylemleri kalır, yenileme düğmesi bulunmaz', () => {
  for (const prefix of ['orders', 'cp']) {
    const start = HTML.indexOf(`id="${prefix}TableToolbar"`);
    const end = HTML.indexOf(`id="${prefix}TableWrap"`, start);
    assert.ok(start >= 0 && end > start);
    const toolbar = HTML.slice(start, end);
    const search = toolbar.indexOf(`id="${prefix}Search"`);
    const actions = toolbar.indexOf(`id="${prefix}TableActions"`);
    assert.ok(search >= 0 && actions > search);
    assert.doesNotMatch(toolbar, /id="(?:orders|cp)RefreshBtn"/);
  }
  assert.doesNotMatch(APP, /(?:orders|cp)RefreshBtn/);
});

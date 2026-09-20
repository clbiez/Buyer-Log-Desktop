'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const APP = read('public/app-main.js');
const GRID = read('public/collection-spreadsheet.js');
const INDEX = read('public/index.html');

test('v10.33 Collection spreadsheet görünür belge dilini kullanır', () => {
  assert.match(GRID, /const lang=\(\)=>document\.documentElement\.lang==='en'\?'en':'tr'/);
  assert.doesNotMatch(GRID, /global\.appLang/);
  assert.match(INDEX, /collection-spreadsheet\.js\?v=__BL_ASSET_VERSION__&rev=[A-Za-z0-9._-]+/);
});

test('v10.33 görünüm ve yetki panelinin tüm görünür metinleri ortak sözlükten gelir', () => {
  for (const key of ['workspacePermissions','viewHelp','sharedPermissions','remove','noGrants','addUser','searchUser','noUsers','add','me']) {
    assert.match(APP, new RegExp(`${key}:\\{tr:`));
    assert.match(APP, new RegExp(`(?:kolScopeText|t)\\('${key}'\\)`));
  }
});

test('v10.33 Collection kapsamı aria etiketi ve boş seçim uyarısı seçili dile uyar', () => {
  assert.match(APP, /setAttribute\('aria-label',kolScopeText\('workspacePermissions'\)\)/);
  assert.match(APP, /showToast\(kolScopeText\('atLeastOneWorkspace'\)\)/);
  assert.match(APP, /atLeastOneWorkspace:\{tr:[^}]*en:/);
});

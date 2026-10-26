'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = relative => fs.readFileSync(path.join(ROOT, relative), 'utf8');
const SERVER = require('./helpers/server-source')();
const PICKER = read('server/lib/ChooseFolder.ps1');
const CP_ASSIST = read('public/cp-overview-assistant.js');
const APP = read('public/app-main.js');
const CSS = require('./helpers/manifest-css')();
const INDEX = read('public/index.html');

test('Kaynak klasör seçiminde eski FolderBrowserDialog yerine Sync ile aynı modern Shell picker modu kullanılır', () => {
  const routeStart = SERVER.indexOf("app.post('/api/choose-folder'");
  const route = SERVER.slice(routeStart, routeStart + 900);
  assert.match(route, /chooseFolderDialog\(\{ mode:'modern', initialPath:sourceFolderForUser\(id\) \|\| '' \}\)/);
  assert.match(PICKER, /if \(\$NetworkMode -or \$ModernMode\)/);
  assert.match(PICKER, /System\.Windows\.Forms\.OpenFileDialog/);
  assert.match(PICKER, /Kaynak klasörünü seçin \(klasörün içine girip Aç'a basın\)/);
});

test('Bugünün Üretim Öncelikleri kalıcı Buyer görünümünde ve Kırılımlar Buyer layoutuna dahil değildir', () => {
  assert.match(CP_ASSIST, /perspective: 'buyer'/);
  assert.match(CP_ASSIST, /buyer: \['priorities', 'checklist'\]/);
  assert.match(CP_ASSIST, /function activeModuleLayout\(\)[\s\S]*?const perspective = 'buyer';[\s\S]*?state\.perspective = perspective/);
  assert.match(CP_ASSIST, /function openModuleLayout\(\)[\s\S]*?const perspective = 'buyer'/);
  assert.doesNotMatch(CP_ASSIST, /data-cpa-perspective|cpaPerspective/);
});

test('Model Bütçe Ayı/Hafta picker hard-coded dark surface yerine aktif tema tokenlarını kullanır', () => {
  const block=require('./helpers/manifest-css').rules(/kolPeriodDrawer|kolPeriodOption/);
  assert.match(block,/background:var\(--ui-surface\)/);
  assert.match(block,/color:var\(--ui-text\)/);
  require('./helpers/manifest-css').assertReset();
  assert.match(block,/\.kolPeriodOption\.isSelected\{[^}]*background:var\(--ui-selected\)/);
  assert.match(block,/scrollbar-color:var\(--ui-group-divider\) transparent/);
  assert.doesNotMatch(block,/background:\s*#[0-9a-f]{3,8}|color:\s*#[0-9a-f]{3,8}/i);
  assert.match(APP, /backdrop\.className='kolPeriodDrawerBackdrop'/);
  assert.match(APP, /panel\.className='kolPeriodDrawer'/);
});

test('Focus / Extended / All üçlüsü CP, Orders ve Collection için aynı sırada bulunur', () => {
  for (const tableKey of ['cp','orders','koleksiyon']) {
    const prefix = tableKey === 'koleksiyon' ? 'kol' : tableKey;
    const start = INDEX.indexOf(`id="${prefix}TableViewActions"`);
    assert.ok(start >= 0, `${tableKey} view actions bulunmalı`);
    // Menü açılır yapıya taşınınca seçenekler üst satırda 1400 karaktere sığmak zorunda değil.
    const fields = INDEX.indexOf(`data-table-fields="${tableKey}"`, start);
    assert.ok(fields > start, `${tableKey}: Alanlar aynı görünüm menüsünde bulunmalı`);
    const block = INDEX.slice(start, fields);
    const focus = block.indexOf('data-table-view-preset="focus"');
    const extended = block.indexOf('data-table-view-preset="extended"');
    const all = block.indexOf('data-table-view-preset="all"');
    assert.ok(focus >= 0 && extended > focus && all > extended, `${tableKey}: Focus → Extended → All sırası korunmalı`);
  }
});

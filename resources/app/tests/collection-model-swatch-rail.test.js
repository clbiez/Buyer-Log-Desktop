'use strict';
// Koleksiyon gutter: satır numarası yok; model satırında renk sayacı (aç/kapa),
// her renk satırında gerçek renk noktası; model şeridi grubu birlikte seçer.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Groups = require('../public/collection-model-groups.js');

const ROOT = path.join(__dirname, '..');
const APP = fs.readFileSync(path.join(ROOT, 'public', 'app-main.js'), 'utf8');
const CSS = fs.readFileSync(path.join(ROOT, 'public', 'collection-spreadsheet.css'), 'utf8');
const UI = fs.readFileSync(path.join(ROOT, 'public', 'ui-components.css'), 'utf8');
const renderBlock = () => {
  const start = APP.indexOf('function renderKol()');
  return APP.slice(start, APP.indexOf('function renderKolSummaryFooter', start));
};

test('colourSwatch: hex değeri, TR/EN renk adı ve bilinmeyen renk', () => {
  assert.equal(Groups.colourSwatch({ colour: '#1A2B3C' }), '#1a2b3c');
  assert.equal(Groups.colourSwatch({ colour: '', colourCode: '#abcdef' }), '#abcdef');
  assert.equal(Groups.colourSwatch({ colour: 'NAVY' }), Groups.colourSwatch({ colour: 'Lacivert' }));
  assert.equal(Groups.colourSwatch({ colour: 'SİYAH' }), Groups.colourSwatch({ colour: 'black' }));
  assert.equal(Groups.colourSwatch({ colour: 'KIRMIZI' }), Groups.colourSwatch({ colour: 'RED' }));
  assert.notEqual(Groups.colourSwatch({ colour: 'GREY MEL' }), '');
  assert.notEqual(Groups.colourSwatch({ colour: 'NAVY BLUE' }), Groups.colourSwatch({ colour: 'BLUE' }), 'navy önce eşleşir');
  assert.equal(Groups.colourSwatch({ colour: 'Kod 123', colourCode: 'X9' }), '');
  assert.equal(Groups.colourSwatch(null), '');
  assert.equal(Groups.colourSwatch({ colour: 'white' }), Groups.colourSwatch({ colour: 'WHITE' }));
  assert.equal(Groups.colourSwatch({ colour: 'indigo' }), Groups.colourSwatch({ colour: 'INDIGO' }));
  // Kelime içi eşleşme yok: "REDWOOD" değil, ama "DARK RED" kırmızı.
  assert.equal(Groups.colourSwatch({ colour: 'TIRED' }), '');
  assert.equal(Groups.colourSwatch({ colour: 'DARK RED' }), Groups.colourSwatch({ colour: 'RED' }));
});

test('gutter satır numarası taşımaz, sayaç + renk noktası çizer', () => {
  const block = renderBlock();
  assert.doesNotMatch(APP, /class="kolSpreadsheetRowNumber"/);
  assert.doesNotMatch(APP, /data-kol-row-number=/);
  assert.match(block, /class="kolModelGroupToggle kolModelGroupCount"/);
  assert.match(block, /data-kol-group-toggle="\$\{escapeHtml\(r\.modelGroupId\)\}"/);
  assert.match(block, />\$\{railCount\}<\/button>/);
  assert.match(block, /class="kolColourDot\$\{swatch\?'':' isUnknown'\}"/);
  assert.match(block, /--kol-dot:\$\{swatch\}/);
  assert.match(block, /kolSpreadsheetGutterCol" style="width:48px;/);
  assert.doesNotMatch(CSS, /\.kolSpreadsheetRowNumber\{/);
  assert.doesNotMatch(UI, /\.kolSpreadsheetRowNumber/);
  assert.ok(CSS.includes('#view-koleksiyon.kolSpreadsheetWorkspace #kolTable td.kolSpreadsheetRowGutter{width:48px!important;min-width:48px!important}'));
  assert.match(UI, /#kolTable :is\(\.kolSpreadsheetRowGutter,\.chkTh\)\{width:48px!important;min-width:48px!important;max-width:48px!important/);
  assert.match(CSS, /\.kolColourDot\{[^}]*border-radius:var\(--ui-radius\);/, 'renk işareti kare (nokta değil)');
  assert.match(CSS, /\.kolColourDot\.isUnknown\{/);
});

test('model şeridi grubu seçer, renk şeridi tek rengi; kısmi seçim yarım görünür', () => {
  const block = renderBlock();
  assert.match(block, /data-kol-rail="\$\{railRole\}"/);
  assert.match(block, /railCount>1\?'parent':\(showAsVariant\?'variant':'single'\)/);
  assert.match(block, /dataset\.kolRail==='parent'&&members\.length>1/);
  assert.match(block, /const target=!members\.every\(item=>selectionHasId\(kolSelected,item\.id\)\)/);
  assert.match(block, /else selectionSetId\(kolSelected,id,chk\.checked\)/);
  assert.match(block, /chk\.indeterminate=false/);
  assert.match(APP, /function kolSyncModelRail\(tbody,members,logicalIds\)\{[\s\S]*?chk\.indeterminate=count>0&&count<visible\.length;/);
  assert.match(block, /Select model with all \$\{railCount\} colour options/);
  assert.match(block, /Modeli \$\{railCount\} renk opsiyonuyla birlikte seç/);
  assert.match(block, /Select this colour option only/);
  assert.match(block, /Yalnız bu renk opsiyonunu seç/);
});

test('odakta kalan satır seçim kutusu grup aç/kapa çizimini ertelemez', () => {
  const editing = APP.slice(APP.indexOf('function kolEditingRowIds()'), APP.indexOf('function kolHasActiveRowEditor()'));
  assert.match(editing, /if\(active\.matches\?\.\('\.rowChk,#kolSelAll'\)\)return null;/);
  const workspace = APP.slice(APP.indexOf('function kolHasActiveWorkspaceEditor()'), APP.indexOf('function kolDirtyRowIds()'));
  assert.match(workspace, /#view-koleksiyon input:not\(\.rowChk\):not\(#kolSelAll\)/);
  // Gerçek veri editörleri hâlâ korunur.
  assert.match(workspace, /#view-koleksiyon textarea, #view-koleksiyon select/);
});

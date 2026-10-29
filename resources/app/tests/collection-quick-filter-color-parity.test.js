'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ROOT = path.join(__dirname, '..', 'public');
const APP = fs.readFileSync(path.join(ROOT, 'app-main.js'), 'utf8');
const CSS = fs.readFileSync(path.join(ROOT, 'app.css'), 'utf8');
const STATUS = require(path.join(ROOT, 'collection-status-catalog.js'));
const start = APP.indexOf('function kolQuickFilterTone(key){');
const end = APP.indexOf('// ================= PRICING PREFLIGHT', start);
const block = APP.slice(start, end);

test('Collection quick filter uses CP-style tone families, not blue for every option', () => {
  assert.ok(start >= 0 && end > start);
  const helper = block.slice(0, block.indexOf('function renderKolQuickFilters(){'));
  const tone = vm.runInNewContext(helper + '\\nkolQuickFilterTone;');
  assert.equal(tone('season'), 'blue');
  assert.equal(tone('inStoreMonth'), 'blue');
  assert.equal(tone('inStoreWeek'), 'blue');
  assert.equal(tone('delType'), 'purple');
  assert.equal(tone('urunTipi'), 'gray');
  assert.equal(tone('durum'), 'gray');
  assert.equal(tone('customDimension'), 'gray');
  assert.match(block, /class="kpi tone-\\$\\{tone\\}\\$\\{active\\?' active':''\\}"/);
  assert.doesNotMatch(block, /class="kpi tone-blue\\$\\{active/);
});

test('Collection Status chips take their catalog color, retaining CP active selection styling', () => {
  assert.match(block, /statusColors=quickDims\\.some\\(dim=>dim\\.key==='durum'\\)\\?kolStatusRenderSnapshot\\(\\):null/);
  assert.match(block, /statusColors\\.color\\(val\\)/);
  assert.match(block, /aria-pressed="\\$\\{active\\?'true':'false'\\}"/);
  assert.match(CSS, /#kolQuickFilters \\.kpi\\[data-kolq-key="durum"\\]:not\\(\\.active\\) \\.n/);
  assert.match(CSS, /--kol-quick-status-color/);
  assert.equal(STATUS.color(STATUS.seed(), 'İptal'), '#D92D20');
  assert.equal(STATUS.color(STATUS.normalize([{name:'My Status',color:'#12ab34'}]), 'My Status'), '#12AB34');
});

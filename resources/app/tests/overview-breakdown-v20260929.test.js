'use strict';

/* Aktif Sipariş Kırılımı: eski dört radar modülünün (Ülke, Alt Üretici,
   Sezon, Buying Group) birleşimi. Radar testlerinin koruduğu gerekçeler
   burada sürer: sayılar deterministik, karışık para birimli FOB çubuk
   ölçeğine girmez, grafik satırı tablo satırıyla aynı CP drill'ini uygular. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const B = require('../public/overview-breakdown.js');

const ROOT = path.join(__dirname, '..');
const INDEX = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');
const APP = fs.readFileSync(path.join(ROOT, 'public', 'app-main.js'), 'utf8');
const STORAGE = fs.readFileSync(path.join(ROOT, 'public', 'user-storage.js'), 'utf8');

test('tek serili kırılım büyükten küçüğe sıralanır, pay ve oran hesaplanır, sıfırlar atılır', () => {
  const s = B.singleSeries([['India', 46], ['Bangladesh', 98], ['China', 2], ['Empty', 0]]);
  assert.deepEqual(s.rows.map(r => r.label), ['Bangladesh', 'India', 'China']);
  assert.equal(s.total, 146);
  assert.equal(s.rows[0].ratio, 1);
  assert.equal(s.rows[0].share, 67.1);
});

test('sezon kırılımı öncelik parçalarını sabit kod sırasıyla taşır', () => {
  const codes = ['CRITICAL', 'ACTION_TODAY', 'WATCH'];
  const s = B.stackedSeries([
    { label: 'S7', count: 72, qty: 412118, priorities: { WATCH: 51, CRITICAL: 21 } },
    { label: 'WS1', count: 74, qty: 423287, priorities: { CRITICAL: 4, WATCH: 69 } },
  ], codes);
  assert.deepEqual(s.rows.map(r => r.label), ['WS1', 'S7']);
  assert.deepEqual(s.rows[0].parts.map(p => p.code), codes);
  assert.deepEqual(s.rows[0].parts.map(p => p.value), [4, 0, 69]);
  assert.equal(s.rows[1].ratio, 72 / 74);
});

test('buying group çubuk uzunluğu yalnız aktif sipariş sayısıdır; FOB metin olarak kalır', () => {
  const s = B.groupSeries([
    { label: 'LISANS', active: 146, total: 156, remaining: 832910, totalQty: 901015, fobUsd: 2438888, fobTry: 0 },
    { label: 'KIDS', active: 73, total: 80, remaining: 1, totalQty: 2, fobUsd: 99999999, fobTry: 500 },
  ]);
  assert.equal(s.rows[0].label, 'LISANS');
  assert.equal(s.rows[0].ratio, 1);
  assert.equal(s.rows[1].ratio, 0.5);
});

test('widget dört boyutu, grafik/tablo geçişini ve tablo drill kaynaklarını taşır', () => {
  for (const dim of B.DIMENSIONS) assert.match(INDEX, new RegExp(`data-breakdown-dim="${dim}"`));
  for (const id of ['tblCountry', 'tblLicense', 'tblSeason', 'tblBuyingGroup', 'ovBreakdownChart', 'ovFilterBadge', 'ovFilterBadgeBg']) assert.match(INDEX, new RegExp(`id="${id}"`));
  assert.match(INDEX, /data-breakdown-view/);
  assert.match(INDEX, /data-ovfilter-trigger="bg"/);
  assert.match(INDEX, /overview-breakdown\.js/);
  assert.doesNotMatch(INDEX, /overview-radar/);
  assert.equal(B.STORAGE_KEY, 'buyerlog.overview.breakdown.v1');
  assert.match(STORAGE, /'buyerlog\.overview\.breakdown\.'/);
});

test('app-main grafik modelini tablolarla aynı toplamlardan kurar ve drill\'i CP filtresine bağlar', () => {
  assert.match(APP, /breakdown\.country=groupCount\(cpRows,'Country'\)/);
  assert.match(APP, /breakdown\.subManufacturer=groupCount\(cpRows,'Sub-Manufacturer'\)/);
  assert.match(APP, /breakdown\.season=\{codes:actionPriorityCodes\(\)/);
  assert.match(APP, /breakdown\.buyingGroup=bgRows\.map/);
  assert.match(APP, /season:\(v,pri\)=>\{clearCpQuickFilters\(\);setSelectValue\('cpFSeason',v\);if\(pri\)setSelectValue\('cpFPriority',pri\)/);
  assert.match(APP, /window\.BLOverviewBreakdown\?\.update\?\.\(breakdown\)/);
  assert.doesNotMatch(APP, /renderOverviewPriorityRadar|BLOverviewRadar/);
  // Ad sütunu kaynak verisinden gelir; HTML olarak yorumlanmaz.
  assert.match(APP, /entries\.map\(\(\[k,v\]\)=>`<tr><td>\$\{escapeHtml\(k\)\}<\/td>/);
});

'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const ROOT=path.join(__dirname,'..');
const HTML=(fs.readFileSync(path.join(ROOT,'public', 'index.html'), 'utf8') + '\n' + fs.readFileSync(path.join(ROOT,'public', 'app-main.js'), 'utf8'));
const QUOT=fs.readFileSync(path.join(ROOT,'public','quotations.js'),'utf8');
const CSS=fs.readFileSync(path.join(ROOT,'public','app.css'),'utf8');

test('v4.66 quotation-only confirmed columns and column dragging are removed',()=>{
  assert.doesNotMatch(QUOT,/COLUMN_ORDER_KEY/);
  assert.doesNotMatch(QUOT,/qBindColumnReorder/);
  assert.doesNotMatch(QUOT,/data-qmove=/);
  assert.doesNotMatch(QUOT,/key:'confirmedManufacturer'/);
  assert.doesNotMatch(QUOT,/key:'confirmedFob'/);
});

test('v4.66 collection confirmed columns show muted Best Price fallback',()=>{
  assert.match(HTML,/function kolConfirmedDisplay\(row\)/);
  assert.match(HTML,/return best\?\{\.\.\.best,isFallback:true\}:null/);
  assert.match(HTML,/confirmedDisplay=kolConfirmedDisplay\(r\)/);
  assert.match(HTML,/kolConfirmedFallback/);
  assert.match(HTML,/Best Price üreticisi referans olarak gösteriliyor/);
  assert.match(HTML,/Best Price referans olarak gösteriliyor/);
  assert.match(CSS,/#kolTable td\.kolConfirmedFallback\{/);
});

test('v4.66 collection synthetic pricing columns join persistent move and resize order',()=>{
  assert.match(HTML,/const KOL_SYNTHETIC_COL_KEYS = Object\.freeze\(\['__bestPrice__','__confirmedName__','__confirmedPrice__'\]\)/);
  assert.match(HTML,/function kolNormalizeDisplayOrder\(order\)/);
  assert.match(HTML,/if\(!kolColOrder\)kolColOrder=kolDefaultDisplayOrder\(\)/);
  assert.match(HTML,/descriptors\.map\(d=>`<col data-kcol="\$\{d\.k\}"/);
  assert.match(HTML,/thead\.querySelectorAll\('th\[data-kcol\]'\)\.forEach/);
  // v2026-10-22: Kompakt görünümün özet sütunları kalıcı sıraya ait değildir ve sürüklenmez;
  // gerçek sütunlar sürüklenir, hepsi yeniden boyutlanır.
  assert.match(HTML,/if\(!viewColumn\)attachKolColDrag\(th,key\);\n    attachKolColResize\(th,key,table,colgroup\)/);
  assert.match(HTML,/const saved=Number\(kolColWidths\[d\.k\]\)/);
});

test('v4.66 landed columns remain at the far right after collection column moves',()=>{
  assert.match(HTML,/function kolPlaceLandedAtEnd\(order\)/);
  assert.match(HTML,/out\.push\('ydLanded','trLanded'\)/);
  assert.match(HTML,/kolColOrder=kolPlaceLandedAtEnd\(kolColOrder\)/);
});

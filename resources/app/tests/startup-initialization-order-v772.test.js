'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const ROOT=path.join(__dirname,'..');
const APP=fs.readFileSync(path.join(ROOT,'public','app-main.js'),'utf8');
const INDEX=fs.readFileSync(path.join(ROOT,'public','index.html'),'utf8');

test('v7.72 Overview ilk çizimi dil sözlükleri başlatıldıktan sonra çalışır',()=>{
  const dict=APP.indexOf('const KOL_EN_TR_DICT =');
  assert.ok(dict>=0,'KOL dil sözlüğü bulunamadı');
  assert.doesNotMatch(APP.slice(0,dict),/^renderOverviewCollectionSummary\(\);$/m);
});

test('v7.72 erken document listener Koleksiyon öneri paneli değişkeninden sonra bağlanır',()=>{
  const declaration=APP.indexOf('let _kolCatalogDrop = null');
  const listener=APP.indexOf('if(_kolCatalogDrop &&');
  assert.ok(declaration>=0&&listener>=0&&declaration<listener,'öneri paneli bildirimi listener öncesinde olmalı');
});

test('v7.72 inline bootstrap backlog lexical sabitlerine doğrudan erişmez',()=>{
  const marker=INDEX.indexOf('// Backlog picker initialization');
  assert.ok(marker>=0,'backlog bootstrap açıklaması bulunamadı');
  const block=INDEX.slice(Math.max(0,marker-500),marker+500);
  assert.doesNotMatch(block,/BACKLOG_DIM_ORDER|BACKLOG_DIM_LABELS_FE/);
});

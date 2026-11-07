'use strict';
// CP ilk açılış profili (30k demo, 24.982 satır): set/parça kimliği satırın
// açıklama alanlarını her kalem ve her geçişte yeniden okuyordu. CP satırında
// "Product Main Definition" ve set parça sayısı başlıkları yok; ortak alan
// okuyucusu her eksik başlık için satırın 90 başlığını tarıyordu (~3 sn).
// Tek bir senkron hesap geçişinde satır başına bir kez okunur; geçiş dışında
// davranış aynıdır (değişen satır yeniden okunur).
const test=require('node:test'),assert=require('node:assert/strict');
const Fields=require('../public/canonical-fields');
const C=require('../public/checklist-components-engine');
const fs=require('node:fs'),path=require('node:path');

function rows(){return [
  {'Category':'PIJAMA','Ürün Tanım':'PIJAMA TAKIM 2 Lİ'},
  {'Category':'KAZAK','Ürün Tanım':'KAZAK'},
  {'Category':'SET','Ürün Tanım':'SET OF 3','Set Piece Count':''},
];}
// Satır erişimlerini sayan Proxy: her alan okuması ve her başlık taraması sayılır.
function tracked(list){
  const stats={reads:0};
  return {stats,rows:list.map(target=>new Proxy(target,{
    get(t,k,r){if(typeof k==='string')stats.reads++;return Reflect.get(t,k,r);},
    ownKeys(t){stats.reads++;return Reflect.ownKeys(t);},
  }))};
}
const evaluate=list=>list.map(r=>[C.isSet(r,'cp'),C.count(r,'cp'),C.isSet(r,'cp'),C.count(r,'cp')]);

test('inside one pass a row is read once and results equal the uncached ones', () => {
  const plain=evaluate(rows());
  const uncached=tracked(rows()),cached=tracked(rows());
  assert.deepEqual(evaluate(uncached.rows),plain);
  assert.deepEqual(C.withRowCache(()=>evaluate(cached.rows)),plain);
  const once=tracked(rows());C.withRowCache(()=>once.rows.forEach(r=>{C.isSet(r,'cp');C.count(r,'cp');}));
  assert.equal(cached.stats.reads,once.stats.reads,'repeated isSet/count calls in a pass add no row reads');
  assert.ok(uncached.stats.reads>cached.stats.reads*1.5,`uncached ${uncached.stats.reads} vs cached ${cached.stats.reads}`);
});

test('outside a pass a changed row is read again; passes nest and end cleanly', () => {
  const row={'Category':'KAZAK','Ürün Tanım':'KAZAK'};
  assert.equal(C.isSet(row,'cp'),false);
  row['Ürün Tanım']='KAZAK TAKIM';
  assert.equal(C.isSet(row,'cp'),true,'no cache outside a pass');
  const nested=C.withRowCache(()=>{const a=C.isSet(row,'cp');row['Ürün Tanım']='KAZAK';return [a,C.withRowCache(()=>C.isSet(row,'cp'))];});
  assert.deepEqual(nested,[true,true],'a nested pass reuses the outer pass snapshot');
  assert.equal(C.isSet(row,'cp'),false,'the cache is dropped when the outer pass ends');
  assert.throws(()=>C.withRowCache(()=>{throw new Error('boom');}),/boom/);
  assert.equal(C.isSet(row,'cp'),false,'a throwing pass still clears its cache');
});

test('the CP decision and checklist column passes run inside one row cache', () => {
  const read=file=>fs.readFileSync(path.join(__dirname,'..','public',file),'utf8');
  assert.match(read('cp-overview-assistant.js'),/function applyPersonalLayer\(baseModel, rows, options\) \{\s*return Checklist\.Components\.withRowCache\(\(\) => applyPersonalLayerNow\(baseModel, rows, options\)\);/);
  assert.match(read('checklist-supplier-sync.js'),/function refreshColumns\(options\) \{\s*return Components\.withRowCache\(function \(\) \{ return refreshColumnsNow\(options\); \}\);/);
});

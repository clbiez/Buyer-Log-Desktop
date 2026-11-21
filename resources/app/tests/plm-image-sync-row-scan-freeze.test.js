'use strict';
/* PLM SYNC görsel indirmesinden sonra donma (regresyon kilidi).
   applySyncedPlmImages CP+Orders satırlarının her biri için
   cpImageRefFromOverride → resolveImageRef/hasImageKey çağırır ve haritayı
   indeks VERMEDEN geçirir. Eşleşmeyen her satırda tüm imagemap anahtarları
   taranıyordu (satır × anahtar): 10k satır × 40k anahtar ≈ 100 sn kilit.
   Yayımlanmış kayıt haritası kendi adlı indeksini kullanmalıdır. */
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {createModelImageCache}=require('../public/model-image-cache');

test('published registry map is not enumerated per row by stateless lookups',()=>{
  const raw={};for(let i=0;i<500;i++){raw[`plm:${i}|colour:S01|name:RED`]=`n-${i}`;raw[`plm:${1000+i}|colour:S01`]=`c-${i}`;}
  let scans=0;const map=new Proxy(raw,{ownKeys(target){scans++;return Reflect.ownKeys(target);}});
  const cache=createModelImageCache({});cache.setRegistryMap(map);scans=0;
  for(let i=0;i<200;i++){
    // Eşleşmeyen satır (görseli olmayan model) — eski kodda tam tarama.
    assert.equal(cache.resolveImageRef(map,50000+i,'S01',''),'');
    assert.equal(cache.hasImageKey(map,50000+i,'S01',''),false);
    // Adlı kayıt tek ref'e çözülür; doğrudan kod anahtarı aynen çalışır.
    assert.equal(cache.resolveImageRef(map,i,'S01',''),`n-${i}`);
    assert.equal(cache.hasImageKey(map,i,'S01',''),true);
    assert.equal(cache.resolveImageRef(map,1000+i,'S01',''),`c-${i}`);
  }
  assert.equal(scans,0,'row loops must use the registry index, not scan every key');
});

test('registered map stays correct after patchRegistryMap and republish',()=>{
  const map={'plm:7|colour:C|name:RED':'first'},cache=createModelImageCache({});cache.setRegistryMap(map);
  assert.equal(cache.resolveImageRef(map,7,'C'),'first');
  cache.patchRegistryMap({'plm:7|colour:C|name:BLUE':'second'});
  assert.equal(cache.resolveImageRef(map,7,'C'),'','two different named refs stay ambiguous');
  cache.patchRegistryMap({'plm:7|colour:C|name:RED':null});
  assert.equal(cache.resolveImageRef(map,7,'C'),'second');
  map['plm:8|colour:C|name:X']='third';cache.setRegistryMap(map);
  assert.equal(cache.hasImageKey(map,8,'C'),true);
  // Yayımlanmamış başka bir harita durumsuz kalır.
  const other={'plm:8|colour:C|name:Y':'other'};
  assert.equal(cache.resolveImageRef(other,8,'C'),'other');
});

test('applySyncedPlmImages publishes the registry before the per-row loop',()=>{
  const src=fs.readFileSync(path.join(__dirname,'..','public','app-main.js'),'utf8');
  const start=src.indexOf('function applySyncedPlmImages(');assert.ok(start>0);
  const body=src.slice(start,src.indexOf('\nfunction ',start+10));
  const sync=body.indexOf('syncModelImageRegistry()'),loop=body.indexOf('cpImageRefFromOverride(');
  assert.ok(sync>0&&loop>sync,'registry must be published (indexed) before rows resolve refs');
});

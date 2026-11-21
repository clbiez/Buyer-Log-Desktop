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

test('server plmImageRef: row loops resolve named keys from a loop-scoped index (no per-row full scan)',()=>{
  const parse=require('../server/lib/parse');
  const raw={'plm:7|colour:C|name:RED':'a','plm:8|colour:C|name:RED':'x','plm:8|colour:C|name:BLUE':'y','plm:9|colour:C|name:RED':'','plm:9':'legacy','plm:10|colour:C':'code'};
  for(let i=0;i<500;i++)raw[`plm:${1000+i}|colour:S|name:N`]=`n${i}`;
  const cases=[{plm:'7',ccode:'C'},{plm:'8',ccode:'C'},{plm:'9',ccode:'C'},{plm:'10',ccode:'C'},{plm:'7',ccode:'C',colour:'RED'},{plm:'404',ccode:'C'}];
  const expected=cases.map(order=>parse.plmImageRef(raw,order));
  let scans=0;const map=new Proxy(raw,{ownKeys(t){scans++;return Reflect.ownKeys(t);}});
  const index=parse.plmImageNamedIndex(map);scans=0;
  for(let n=0;n<200;n++)cases.forEach((order,i)=>assert.equal(parse.plmImageRef(map,order,index),expected[i]));
  assert.equal(scans,0,'indexed lookups must not enumerate the whole imagemap');
  assert.deepEqual(expected,['a',undefined,'',  'code','a',undefined]);
  // Tembel dizin: yalnız adlı-kayıt düşüşünde ve bir kez kurulur.
  scans=0;const lazy=parse.plmImageLazyNamedIndex(map);
  assert.equal(parse.plmImageRef(map,{plm:'10',ccode:'C'},lazy),'code');assert.equal(scans,0,'code-key hits never build the index');
  for(let n=0;n<50;n++)assert.equal(parse.plmImageRef(map,{plm:'7',ccode:'C'},lazy),'a');
  assert.equal(scans,1,'lazy index is built once per loop');
});

test('server row loops build the named image index once before iterating',()=>{
  const parse=fs.readFileSync(path.join(__dirname,'..','server','lib','parse.js'),'utf8');
  const start=parse.indexOf('function backlogTemplateRowsFromSegments(');
  const body=parse.slice(start,parse.indexOf('\nfunction ',start+10));
  assert.ok(body.indexOf('plmImageLazyNamedIndex(')>0&&body.indexOf('plmImageLazyNamedIndex(')<body.indexOf('.map(segment'));
  assert.match(body,/plmImageRef\(overrides && overrides\.imagemap, order, imageNamedIndex\)/);
  const server=fs.readFileSync(path.join(__dirname,'..','server','server.js'),'utf8');
  const s=server.indexOf('function collectionWorkspaceWithLocalImages(');
  const sb=server.slice(s,server.indexOf('\nfunction ',s+10));
  assert.match(sb,/plmImageLazyNamedIndex\(imagemap\)/);assert.match(sb,/\}, imageNamedIndex\)/);
});

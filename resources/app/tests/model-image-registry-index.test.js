'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createModelImageCache}=require('../public/model-image-cache');
test('registry lookups scan named keys once per registry update, preserving ambiguity and tombstones',()=>{
 const raw={};for(let i=0;i<1000;i++)raw[`plm:${i}|colour:S01|name:SIYAH`]=`image-${i}`;
 let scans=0;const map=new Proxy(raw,{ownKeys(target){scans++;return Reflect.ownKeys(target);}}),cache=createModelImageCache({});
 cache.setRegistryMap(map);
 for(let i=0;i<100;i++){
  assert.equal(cache.hasRegistryKey(i,'S01'),true);
  assert.equal(cache.resolveRegistrySource(i,'S01'),`/api/collection-images/image-${i}`);
  assert.equal(cache.hasRegistryKey('missing','S01'),false);
 }
 assert.equal(scans,1,'visible images must not enumerate the entire registry');
 raw['plm:2|colour:S01|name:BLACK']='other';cache.setRegistryMap(map);
 assert.equal(cache.resolveRegistrySource(2,'S01'),'');
 assert.equal(cache.resolveRegistrySource(2,'S01','/api/collection-images','SIYAH'),'/api/collection-images/image-2');
 raw['plm:2|colour:S01']='';cache.setRegistryMap(map);assert.equal(cache.resolveRegistrySource(2,'S01'),'');assert.equal(cache.hasRegistryKey(2,'S01'),true);
 delete raw['plm:2|colour:S01'];delete raw['plm:2|colour:S01|name:BLACK'];raw['plm:2|colour:S01|name:SIYAH']='replacement';cache.setRegistryMap(map);
 assert.equal(cache.resolveRegistrySource(2,'S01'),'/api/collection-images/replacement');
});
test('stateless map resolution still observes in-place mutations without registering a snapshot',()=>{
 const cache=createModelImageCache({}),map={'plm:4|colour:C|name:RED':'first'};
 assert.equal(cache.resolveImageRef(map,4,'C'),'first');map['plm:4|colour:C|name:BLUE']='second';
 assert.equal(cache.resolveImageRef(map,4,'C'),'');delete map['plm:4|colour:C|name:RED'];assert.equal(cache.resolveImageRef(map,4,'C'),'second');
});

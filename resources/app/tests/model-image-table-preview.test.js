'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createModelImageCache}=require('../public/model-image-cache');

function setup(shared=new Map(),options={}){
  const calls={fetch:0,convert:0,revoked:[],sizes:[],originals:[]};let next=0;
  const disk={match:async r=>shared.get(r.url)?.clone(),put:async(r,v)=>shared.set(r.url,v.clone()),keys:async()=>[...shared.keys()].map(url=>new Request(url)),delete:async r=>shared.delete(r.url)};
  const env={Request,Response,location:{origin:'http://localhost'},caches:{open:async()=>disk},
    fetch:async()=>{calls.fetch++;return new Response(new Blob(['original'],{type:'image/png'}));},
    URL:{createObjectURL:()=>`blob:preview-${++next}`,revokeObjectURL:url=>calls.revoked.push(url)},
    createImageBitmap:async()=>({width:3000,height:4000,close(){}}),
    OffscreenCanvas:class{constructor(w,h){calls.sizes.push([w,h]);}getContext(){return{fillRect(){},drawImage(){}};}async convertToBlob(options){calls.convert++;assert.equal(options.quality,.85);return new Blob(['preview'],{type:'image/webp'});}},
    Image:class{set src(v){calls.originals.push(v);queueMicrotask(()=>this.onload());}decode(){return Promise.resolve();}}};
  return {cache:createModelImageCache(env,options),calls,shared,env};
}
test('INT-08: same canonical source derives once across warmup and row identities; disk survives reopening',async()=>{
  const {cache,calls,shared}=setup();
  const [a,b]=await Promise.all([cache.getThumbnail({source:'/api/cp-images/ci_1'}),cache.getThumbnail({source:'/api/collection-images/ci_1',modelId:'M1',colourCode:'C1'})]);
  assert.match(a,/^blob:/);assert.equal(a,b);assert.equal(calls.fetch,1);assert.equal(calls.convert,1);
  assert.deepEqual(calls.sizes,[[192,256]]);
  const reopened=setup(shared);assert.match(await reopened.cache.getThumbnail({source:'/api/collection-images/ci_1'}),/^blob:/);
  assert.equal(reopened.calls.fetch,0);assert.equal(reopened.calls.convert,0);
  await cache.preloadOriginal({source:'/api/collection-images/ci_1'});
  assert.deepEqual(calls.originals,['/api/collection-images/ci_1']);
});
test('INT-08: invalidation releases preview; binding retains original data-src and ignores recycled cells',async()=>{
  const {cache,calls}=setup(),source='/api/collection-images/ci_2';
  const img={dataset:{src:source},isConnected:true};await cache.bind(img);
  assert.match(img.src,/^blob:/);assert.equal(img.dataset.src,source);
  await cache.invalidate(source);assert.equal(calls.revoked.length,1);assert.equal(cache.stats().thumbnailMemoryEntries,0);
  const next=cache.bind(img);img.dataset.src='/api/collection-images/ci_3';const old=img.src;
  await next;assert.equal(img.src,old);
});
test('INT-08: reset during conversion cannot republish a deleted preview',async()=>{
  let release;const {cache,calls}=setup();
  // Keep the original response pending until clearAll has removed its owner.
  const env={Request,Response,location:{origin:'http://localhost'},URL:{createObjectURL(){calls.convert++;return 'blob:late';}},fetch:()=>new Promise(r=>{release=r;})};
  const pendingCache=createModelImageCache(env,{thumbnailer:async blob=>blob});
  const pending=pendingCache.getThumbnail({source:'/api/collection-images/late'});
  while(!release)await new Promise(setImmediate);
  await pendingCache.clearAll();release(new Response(new Blob(['valid'])));
  await assert.rejects(pending,error=>error.code==='BL_IMAGE_CANCELLED');assert.equal(calls.convert,0);assert.equal(pendingCache.stats().thumbnailMemoryEntries,0);
  assert.equal(cache.stats().thumbnailMemoryEntries,0);
});
test('INT-08: warmup, prior and loaded use previews; drawer and hover retain the original',async()=>{
  const fs=require('node:fs'),path=require('node:path');
  const app=fs.readFileSync(path.join(__dirname,'../public/app-main.js'),'utf8');
  const start=app.indexOf('const BLImageRuntime=(()=>{'),end=app.indexOf('window.BLImageRuntime=BLImageRuntime;',start);
  const requested=[],originals=[],known=JSON.stringify(['/api/collection-images/prior']);
  const previews=new Map();
  const cache={peekThumbnail:src=>previews.get(src)||'',getThumbnail:async({source})=>{const url='blob:'+source;previews.set(source,url);return url;},
    fromImage:img=>({source:img.dataset.src}),bind:async img=>{img.src=await cache.getThumbnail(cache.fromImage(img));img.dataset.blImageLoaded='1';},
    preloadOriginal:async({source})=>{originals.push(source);return source;}};
  class Image{constructor(){this.isConnected=false;this.naturalWidth=154;this.naturalHeight=256;}set src(v){this._src=v;requested.push(v);queueMicrotask(()=>this.onload?.());}get src(){return this._src;}decode(){return Promise.resolve();}}
  const window={BLModelImageCache:cache,localStorage:{getItem:()=>known,setItem(){},removeItem(){}},requestIdleCallback:cb=>cb({timeRemaining:()=>10})};
  const runtime=new Function('window','Image','IntersectionObserver','modelImageUrl','kolImagePlaceholderSvg','kolShowImgPopup',`${app.slice(start,end)};return BLImageRuntime;`)(window,Image,undefined,x=>x,()=>'',()=>{});
  const cell=(source,extra={})=>({dataset:{src:source,...extra},isConnected:true,addEventListener(){},closest(){return null;}});
  runtime.warmup(['/api/collection-images/warm']);await new Promise(r=>setTimeout(r,650));
  assert.ok(requested.includes('blob:/api/collection-images/warm'));
  const prior=cell('/api/collection-images/prior',{blImagePrior:'1'});runtime.observe(prior);await new Promise(setImmediate);assert.match(prior.src,/^blob:/);
  const loaded=cell('/api/collection-images/prior');runtime.observe(loaded);assert.match(loaded.src,/^blob:/);
  const drawer=cell('/api/collection-images/drawer');drawer.closest=()=>({});runtime.observe(drawer);await new Promise(setImmediate);assert.equal(drawer.src,drawer.dataset.src);
  runtime.scheduleHover(prior,{});await new Promise(r=>setTimeout(r,160));
  assert.deepEqual(originals,['/api/collection-images/drawer','/api/collection-images/prior']);
  assert.ok(requested.every(src=>src.startsWith('blob:')));
});
test('INT-08: runtime reset never negatively caches an abandoned conversion',async()=>{
  const {cache,env}=setup();let release;
  env.fetch=()=>new Promise(r=>{release=r;});
  const app=require('node:fs').readFileSync(require('node:path').join(__dirname,'../public/app-main.js'),'utf8');
  const start=app.indexOf('const BLImageRuntime=(()=>{'),end=app.indexOf('window.BLImageRuntime=BLImageRuntime;',start);
  const runtime=new Function('window','Image','IntersectionObserver',`${app.slice(start,end)};return BLImageRuntime;`)({BLModelImageCache:cache},class{},undefined);
  const pending=runtime.load('/api/collection-images/reset');
  while(!release)await new Promise(setImmediate);
  await runtime.clearAll();release(new Response(new Blob(['image'])));
  await assert.rejects(pending,error=>error.code==='BL_IMAGE_CANCELLED');
  assert.equal(runtime.failed.size,0);assert.equal(runtime.stats().loaded,0);assert.equal(runtime.stats().warm,0);
});
test('INT-08: export measures original data, preserving the exact pre-preview aspect ratio',async()=>{
  const app=require('node:fs').readFileSync(require('node:path').join(__dirname,'../public/app-main.js'),'utf8');
  const start=app.indexOf('function _copyImageNaturalSize('),end=app.indexOf('async function _copyCellFromTd(',start);
  class Image{constructor(){this.naturalWidth=257;this.naturalHeight=265;}set src(value){queueMicrotask(()=>this.onload());}}
  const measure=new Function('Image',`${app.slice(start,end)};return _copyImageNaturalSize;`)(Image);
  const size=await measure('data:image/png;base64,original',{src:'blob:preview',naturalWidth:248,naturalHeight:256},180,114,new Map());
  assert.deepEqual(size,{width:257,height:265});
});
test('INT-08: an evicted prior preview reset during bind is cancellation, not a failed image',async()=>{
  const {cache,env,shared}=setup(new Map(),{thumbnailMemoryLimit:1});
  const app=require('node:fs').readFileSync(require('node:path').join(__dirname,'../public/app-main.js'),'utf8');
  const start=app.indexOf('const BLImageRuntime=(()=>{'),end=app.indexOf('window.BLImageRuntime=BLImageRuntime;',start);
  const runtime=new Function('window','Image','IntersectionObserver',`${app.slice(start,end)};return BLImageRuntime;`)({BLModelImageCache:cache},env.Image,undefined);
  const source='/api/collection-images/evicted';await runtime.load(source);await runtime.load('/api/collection-images/other');
  assert.equal(cache.peekThumbnail(source),'');shared.clear();let release;
  env.fetch=()=>new Promise(r=>{release=r;});
  const img={dataset:{src:source,blImagePrior:'1'},isConnected:true};runtime.observe(img);
  while(!release)await new Promise(setImmediate);
  await runtime.clearAll();release(new Response(new Blob(['image'])));
  await new Promise(setImmediate);await new Promise(setImmediate);
  assert.equal(runtime.failed.size,0);assert.notEqual(img.dataset.blImageFailed,'1');
});

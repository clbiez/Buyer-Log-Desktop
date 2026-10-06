'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../public/app-main.js'),'utf8');
test('replacing a visible range releases image observers and detached images cannot start loads',()=>{
 const start=source.indexOf('const BLImageRuntime=(()=>{'),end=source.indexOf('window.BLImageRuntime=BLImageRuntime;',start);
 const observed=new Set();let callback;
 class Observer{constructor(cb){callback=cb;}observe(img){observed.add(img);}unobserve(img){observed.delete(img);}}
 const runtime=new Function('window','IntersectionObserver','normalizePlmLinkId',`${source.slice(start,end)};return BLImageRuntime;`)({},Observer,()=> '');
 for(let pass=0;pass<40;pass++){
  const images=Array.from({length:50},()=>({dataset:{src:'/api/collection-images/synthetic'},isConnected:true}));
  images.forEach(img=>runtime.observe(img));assert.equal(observed.size,50);
  images.forEach(img=>{img.isConnected=false;});runtime.release({querySelectorAll:()=>images});assert.equal(observed.size,0);
  assert.equal(images[0].dataset.blImageObserved,undefined);
  callback([{isIntersecting:true,target:images[0]}]);assert.equal(runtime.inFlight.size,0);
 }
});

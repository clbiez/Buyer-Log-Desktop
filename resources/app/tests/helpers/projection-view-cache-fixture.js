'use strict';
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),Module=require('node:module');
const crypto=require('node:crypto'),zlib=require('node:zlib'),assert=require('node:assert/strict');
const pins=require('../fixtures/projection-view-cache-pins.json');
const source=path.resolve(__dirname,'../../server/lib/page-projection-cache.js');
const sha=value=>crypto.createHash('sha256').update(value).digest('hex');
const clone=value=>JSON.parse(JSON.stringify(value));
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return{promise,resolve};};
function fixture(t,optionalModulePath){
 const moduleSource=path.resolve(optionalModulePath||source);
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'buyerlog-ready-view-cache-')),hooks=new Map();
 const io={...fs,promises:new Proxy(fs.promises,{get(target,key){const actual=Reflect.get(target,key);
  return typeof actual==='function'?(...args)=>hooks.has(key)?hooks.get(key)(actual.bind(target),...args):actual.apply(target,args):actual;}})};
 const loaded=new Module(moduleSource,module);loaded.filename=moduleSource;loaded.paths=module.paths;
 loaded.require=request=>request==='../user-data'?{LOCAL_DATA_ROOT:root}:request==='./json-dates'?require('../../server/lib/json-dates')
  :request==='./page-projection-schema-binding'?require('../../server/lib/page-projection-schema-binding')
  :request==='fs'?io:require(request);
 const bytes=fs.readFileSync(moduleSource);assert.ok([pins.baseline.sha256,pins.candidate.sha256].includes(sha(bytes)),'exact frozen baseline or candidate cache source');
 loaded._compile(bytes.toString('utf8'),moduleSource);const cache=loaded.exports;
 t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const owner='owner',context='ctx',full={rows:[{'Order Code':'duplicate',zero:0,flag:false,nil:null},{'Order Code':'duplicate',flag:false}]};
 const compress=value=>{const text=JSON.stringify(value);return{buffer:zlib.gzipSync(text),uncompressedBytes:Buffer.byteLength(text)};};
 async function start(extra={}){return cache.writeCompressedGeneration(owner,{contextHash:context,sourceLoadedAt:'synthetic-r1',
  projections:{orders:compress(full),cp:compress({rows:[{cp:true}]})},extra:{moduleInputKeys:{orders:'orders-input1',cp:'cp-input1'},
   sourceProjectionKeys:{orders:'orders-source1',cp:'cp-source1'},sourceRevisionKey:'revision1',...extra}});}
 const manifest=()=>JSON.parse(fs.readFileSync(cache.manifestPath(owner),'utf8'));
 const patch=change=>{const m=manifest();change(m);fs.writeFileSync(cache.manifestPath(owner),JSON.stringify(m));return m;};
 function pin(label='plan1',m=manifest()){return{generation:m.activeGeneration,contextHash:m.contextHash,moduleInputKey:m.moduleInputKeys?.orders,
  sourceProjectionKey:m.sourceProjectionKeys?.orders,fullChecksum:m.modules.orders.checksum,sourceRevisionKey:m.sourceRevisionKey,planHash:sha(label)};}
 function entry(label='view1',registryKeys=['Order Code','zero','flag','nil']){
  const value={profile:'cp-orders-private-view-v1',mode:'shadow',label,rows:clone(full.rows)};
  const encoded=compress(value);return{...encoded,bytes:encoded.buffer.length,checksum:sha(encoded.buffer),registryKeys};
 }
 // Explicit legacy optional-feature adapter: absence is a cache miss, never a fabricated loader RED.
 const read=(p,...args)=>typeof cache.readViewCompressed==='function'?cache.readViewCompressed(owner,'orders',p,...args):Promise.resolve(null);
 const write=(p,e,...args)=>typeof cache.writeViewCompressed==='function'?cache.writeViewCompressed(owner,'orders',p,e,...args):Promise.resolve(null);
 const requireWrite=async(p,e=entry(),options)=>{const meta=await write(p,e,options);assert.ok(meta,'ready-view write must publish supported derived metadata');return meta;};
 function files(){const result=[];for(const dir of fs.readdirSync(path.join(root,'page-cache',owner),{withFileTypes:true})){
  if(!dir.isDirectory())continue;for(const item of fs.readdirSync(path.join(root,'page-cache',owner,dir.name)))
   if(/^orders-view-/.test(item))result.push(path.join(root,'page-cache',owner,dir.name,item));}return result;}
 const viewFile=()=>files().find(file=>file.endsWith('.json.gz'));
 return{cache,root,hooks,owner,context,full,start,manifest,patch,pin,entry,read,write,requireWrite,files,viewFile,compress};
}
module.exports={fixture,sha,clone,deferred,source};

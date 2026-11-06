'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),zlib=require('node:zlib');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'buyerlog-endeksmatik-status-'));process.env.BUYER_LOG_SERVER_DATA_ROOT=root;
const record=['DEMO MMYG','DEMO MAG','KNIT','DEMO GROUP','DEMO CLASS',.4,.3,.2,.1,[100,110],[100,110],[100,110],[100,110]];
const snapshot={schemaVersion:1,months:['202501','202502'],records:[record],fx:{},season:'DEMO',sourceFile:'Synthetic.xlsx',sourceUpdatedAt:'2026-11-05',generatedAt:'2026-11-05T12:00:00Z'};
fs.writeFileSync(path.join(root,'endeksmatik-snapshot.json.gz'),zlib.gzipSync(JSON.stringify(snapshot)));
const engine=require('../server/lib/endeksmatik');test.after(()=>fs.rmSync(root,{recursive:true,force:true}));
test('status reads exact metadata without building calculation indexes; first lookup builds the same indexes lazily',()=>{
 let normalizations=0;const upper=String.prototype.toLocaleUpperCase;
 String.prototype.toLocaleUpperCase=function(...args){normalizations++;return upper.apply(this,args);};
 try{
  const status=engine.publicStatus();assert.equal(status.recordCount,1);assert.equal(status.sourceFile,snapshot.sourceFile);assert.equal(status.setId,'legacy');assert.equal(normalizations,0);
  assert.deepEqual(engine.resolveRecord({mmyg:record[0],mag:record[1],supplyGroup:record[2],buyingGroup:record[3],category:record[4]}),record);assert.ok(normalizations>0);
  const before=normalizations;assert.deepEqual(engine.publicStatus(),status);assert.equal(normalizations,before);
 }finally{String.prototype.toLocaleUpperCase=upper;}
});
test('legacy disk status delegates decompression to the supplied reader and keeps the exact existing schema',async()=>{
  const expected=engine.publicStatus(),legacy=engine.legacyStatus(),gunzip=zlib.gunzipSync;let calls=0;
  zlib.gunzipSync=()=>{throw Error('Status must not decompress on the measured server thread');};
  try{
    const actual=await engine.publicStatusAsync(async descriptor=>{calls++;assert.equal(descriptor.file,engine.PERSISTED_FILE);assert.equal(descriptor.usingDefault,false);assert.ok(descriptor.tag);return legacy;});
    assert.deepEqual(actual,expected);assert.equal(calls,1);
  }finally{zlib.gunzipSync=gunzip;}
});
test('a changed legacy snapshot cannot publish metadata computed for the previous file generation',async()=>{
  const file=engine.PERSISTED_FILE,bytes=fs.readFileSync(file),legacy=engine.legacyStatus();
  try{
    await assert.rejects(engine.publicStatusAsync(async()=>{fs.writeFileSync(file,zlib.gzipSync(JSON.stringify({...snapshot,season:'DEMO CHANGED'})));return legacy;}),{code:'COMPUTE_STALE_GENERATION'});
  }finally{fs.writeFileSync(file,bytes);}
});
test('authoritative shared metadata stays on its canonical document path and cannot be replaced by the disk reader',async()=>{
  const {toDocumentRecord}=require('../server/lib/delta-store');
  const records={snapshot:toDocumentRecord({snapshot:{...snapshot,season:'SHARED DEMO'}})};
  engine.attachDeltaStore({isAuthoritative:true,writesLegacy:false,readAllSync:()=>records});
  try{assert.deepEqual(await engine.publicStatusAsync(()=>{throw Error('Canonical shared snapshot must not read a legacy file');}),engine.publicStatus());}
  finally{engine.attachDeltaStore(null);}
});
test('a newly authoritative shared snapshot invalidates an in-flight legacy disk status',async()=>{
  const {toDocumentRecord}=require('../server/lib/delta-store'),legacy=engine.legacyStatus();
  try{
    await assert.rejects(engine.publicStatusAsync(async()=>{
      engine.attachDeltaStore({isAuthoritative:true,writesLegacy:false,readAllSync:()=>({snapshot:toDocumentRecord({snapshot:{...snapshot,season:'SHARED DEMO CHANGED'}})})});return legacy;
    }),{code:'COMPUTE_STALE_GENERATION'});
  }finally{engine.attachDeltaStore(null);}
});
test('independent imported sets preserve the existing list, active selection and metadata',async()=>{
  await engine.saveSet({...snapshot,id:'em-0123456789abcdef',model:'legacy-tl',hash:'synthetic-set-hash',uploadedAt:'2026-11-05T12:00:00Z'},{activate:false});
  assert.deepEqual(await engine.publicStatusAsync(()=>{throw Error('Imported sets retain their existing resolver');}),engine.publicStatus());
});

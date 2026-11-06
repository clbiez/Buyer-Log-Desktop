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

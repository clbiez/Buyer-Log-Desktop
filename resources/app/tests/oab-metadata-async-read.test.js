'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),fsp=fs.promises,os=require('node:os'),path=require('node:path'),vm=require('node:vm');
const code=fs.readFileSync(require.resolve('../server/lib/oab-static-metadata'),'utf8');
function fixture(t,options={}){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'buyerlog-oab-async-'));fs.mkdirSync(path.join(root,'resources'));
 t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const file=path.join(root,'resources/oab_filter_metadata.json');
 const raw=name=>({schemaVersion:1,reportRef:'OrderBudget_List_Report',generatedAt:'2026-11-05',seasons:[{ref:1,name,mags:[{ref:2,name:'DEMO MAG',buyerGroups:[{ref:3,name:'DEMO BUYER'}]}]}]});
 fs.writeFileSync(file,JSON.stringify(raw('DEMO A')));let reads=0;
 const fake={...fs,statSync(){throw Error('B1: async metadata must not stat on MAIN');},readFileSync(){throw Error('B1: async metadata must not read on MAIN');},promises:{...fsp,
  stat:async(...args)=>options.stat?options.stat(...args):fsp.stat(...args),
  open:async(...args)=>{const handle=await fsp.open(...args),read=handle.readFile.bind(handle);handle.readFile=async(...input)=>{reads++;await options.beforeRead?.(reads);return read(...input);};return handle;}
 }};
 const module={exports:{}},context={module,exports:module.exports,__dirname:path.join(root,'lib'),setImmediate,Buffer,require:name=>name==='fs'?fake:require(name)};
 vm.runInNewContext(code,context);return {api:module.exports,file,raw,reads:()=>reads};
}
test('cold and hot metadata snapshots use async I/O, one shared load, and the canonical getters',async t=>{
 const f=fixture(t);assert.equal(typeof f.api.getSnapshotAsync,'function');
 const [one,two,three]=await Promise.all([f.api.getSnapshotAsync(),f.api.getSnapshotAsync(),f.api.getSnapshotAsync()]);
 assert.equal(one,two);assert.equal(one,three);assert.equal(f.reads(),1);
 assert.equal(await f.api.getSnapshotAsync(),one);assert.equal(f.reads(),1);
 assert.equal(JSON.stringify(f.api.getSeasons(one)),JSON.stringify([{SeasonRef:1,Name:'DEMO A'}]));
 assert.equal(JSON.stringify(f.api.getMag(1,one)),JSON.stringify([{MerchSubGroupRef:2,Name:'DEMO MAG'}]));
 assert.equal(JSON.stringify(f.api.getBuyerGroups(2,one)),JSON.stringify([{BuyerGroupRef:3,Name:'DEMO BUYER'}]));
 assert.equal(f.api.getInfo(one).generatedAt,'2026-11-05');
});
test('mtime-preserving replacement invalidates the async snapshot without a synchronous fallback',async t=>{
 const f=fixture(t),first=await f.api.getSnapshotAsync(),stat=fs.statSync(f.file);
 fs.writeFileSync(f.file,JSON.stringify(f.raw('DEMO B')));fs.utimesSync(f.file,stat.atime,stat.mtime);
 const second=await f.api.getSnapshotAsync();assert.notEqual(first,second);assert.equal(f.api.getSeasons(second)[0].Name,'DEMO B');assert.equal(f.reads(),2);
});
test('a superseded in-flight file read cannot replace a newer successful generation',async t=>{
 let release,started;const gate=new Promise(r=>release=r),reading=new Promise(r=>started=r);
 const f=fixture(t,{beforeRead:async count=>{if(count===1){started();await gate;}}});
 const old=f.api.getSnapshotAsync();old.catch(()=>{});await reading;
 const stat=fs.statSync(f.file);fs.writeFileSync(f.file,JSON.stringify(f.raw('DEMO B')));fs.utimesSync(f.file,stat.atime,stat.mtime);
 const current=await f.api.getSnapshotAsync();release();await assert.rejects(old,error=>error.code==='OAB_STATIC_METADATA_CHANGED'&&Boolean(error.errorEn));
 assert.equal(await f.api.getSnapshotAsync(),current);assert.equal(f.api.getSeasons(current)[0].Name,'DEMO B');
});
test('an older stat completion cannot roll admission back after a newer generation is published',async t=>{
 let release,started,calls=0;const gate=new Promise(r=>release=r),reading=new Promise(r=>started=r);
 const f=fixture(t,{stat:async(...args)=>{const stat=await fsp.stat(...args);if(++calls===1){started();await gate;}return stat;}});
 const old=f.api.getSnapshotAsync();old.catch(()=>{});await reading;
 fs.writeFileSync(f.file,JSON.stringify(f.raw('DEMO B')));const current=await f.api.getSnapshotAsync();release();
 await assert.rejects(old,error=>error.code==='OAB_STATIC_METADATA_CHANGED');assert.equal(await f.api.getSnapshotAsync(),current);
});
test('the fixed bundled source has a byte limit before any file content is read',async t=>{
 const f=fixture(t);fs.truncateSync(f.file,17*1024*1024);
 await assert.rejects(f.api.getSnapshotAsync(),error=>error.code==='OAB_STATIC_METADATA_INVALID'&&Boolean(error.errorEn));assert.equal(f.reads(),0);
});

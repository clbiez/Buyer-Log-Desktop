'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const zlib=require('node:zlib');

const ROOT=path.join(__dirname,'..');
const cacheRoot=fs.mkdtempSync(path.join(os.tmpdir(),'buyerlog-v714-complete-'));
process.env.BUYER_LOG_LOCAL_DATA_ROOT=cacheRoot;
const pageCache=require('../server/lib/page-projection-cache');
const parse=require('../server/lib/parse');
const {runProjectionWorker}=require('../server/lib/projection-worker-client');
const SERVER=fs.readFileSync(path.join(ROOT,'server','server.js'),'utf8');
const APP=fs.readFileSync(path.join(ROOT,'public','app-main.js'),'utf8');

test.after(()=>fs.rmSync(cacheRoot,{recursive:true,force:true}));

function sourceRows(count=24){
  const day=value=>new Date(2026,0,value);
  return Array.from({length:count},(_,index)=>({
    ocode:1000+index,_matchOcode:String(1000+index),kalan:index%3?10:0,qty:20,antrepo:10,fob:5.25,
    license:index%2?'Marvel':'',manufacturer:`M${index}`,season:'S1',countryRaw:'TURKIYE',category:'Cat',
    ozel:'X',plm:200+index,model:`Model ${index}`,ccode:`C${index}`,colour:'Red',opd:day(1),ex:day(5),
    retail:day(10),mb:day(12),shipConf:day(3),buyer:'Buyer',buyerGrup:'BG',ageGroup:'A',merch:'MAG',line:'L',
  }));
}
function overrides(){return {notesmap:{},submap:{},suppfobmap:{},suppfobmetamap:{},delmap:{},licensormap:{},imagemap:{},pricingRules:[],transitRules:[]};}

test('v7.14 shared CP/Orders projection is result-equivalent to two independent builds',()=>{
  const rows=sourceRows(),ov=overrides();
  const shared=parse.buildSharedOrderProjectionRowsFromASAS(rows,{},ov);
  const json=value=>JSON.parse(JSON.stringify(value));
  assert.deepEqual(json(shared.cp),json(parse.buildCPRowsFromASAS(rows,{},ov)));
  assert.deepEqual(json(shared.orders),json(parse.buildOrdersRowsFromASAS(rows,{},ov)));
});

test('v7.14 row-level rewrite atomically advances context without rebuilding raw projections',async()=>{
  await pageCache.writeGeneration('buyer-row',{contextHash:'ctx-before',sourceLoadedAt:'2026-08-25T00:00:00.000Z',projections:{
    cp:{rows:[{'Order Code':1001,Notes:'old'},{'Order Code':1002,Notes:'keep'}]},
    overview:{rows:[{Buyer:'A'}]},
  },extra:{runtimeMeta:{loadedAt:'2026-08-25T00:00:00.000Z'}}});
  const rewritten=await pageCache.rewriteGeneration('buyer-row',{fromContextHash:'ctx-before',toContextHash:'ctx-after',transform:(module,payload)=>{
    if(module==='cp')payload.rows[0].Notes='new';return payload;
  }});
  assert.equal(rewritten.contextHash,'ctx-after');
  const current=await pageCache.readProjection('buyer-row','cp','ctx-after');
  assert.equal(current.data.rows[0].Notes,'new');
  assert.equal(current.data.rows[1].Notes,'keep');
  assert.equal(await pageCache.readProjection('other-user','cp','ctx-after'),null);
});

test('v7.14 bounded projection worker returns transferable gzip payloads accepted by page cache',async()=>{
  const rows=sourceRows(40),ov=overrides();
  const result=await runProjectionWorker({cpSource:rows,ordersSource:rows,cpAntrepo:{},ordersAntrepo:{},overrides:ov,cpModelColumns:[],shared:true,orderSummaryAllowed:true,editableOrderCodes:rows.map(row=>row.ocode)});
  const cp=JSON.parse(zlib.gunzipSync(Buffer.from(result.compressed.cp.buffer)));
  assert.equal(cp.rows.length,26);
  assert.ok(cp.rows.every(row=>row._canEdit===true));
  const compressed=Object.fromEntries(Object.entries(result.compressed).map(([module,entry])=>[module,{buffer:Buffer.from(entry.buffer),uncompressedBytes:entry.uncompressedBytes}]));
  await pageCache.writeCompressedGeneration('worker-user',{contextHash:'worker-context',projections:compressed});
  const cached=await pageCache.readProjection('worker-user','cp','worker-context');
  assert.equal(cached.data.rows.length,26);
});

test('v7.14 refresh sharing, row/image cache patching and bounded facet cache are wired',()=>{
  assert.match(SERVER,/buildCpAndOrdersProjectionRows/);
  assert.match(SERVER,/sameProjectionSourceRows/);
  assert.match(SERVER,/rewriteProjectionCacheForRowPatches/);
  assert.match(SERVER,/rewriteProjectionCacheForImageItems/);
  assert.match(SERVER,/BL_PROJECTION_WORKER_MIN_ROWS/);
  assert.match(APP,/FACET_CACHE_MAX_ENTRIES=96/);
  assert.match(APP,/facetFilterSignature/);
  assert.match(APP,/invalidateCoreFacetCaches/);
});

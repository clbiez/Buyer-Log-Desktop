'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const parse=require('../server/lib/parse'),tasks=require('../server/lib/compute-tasks'),flow=require('../public/overview-global-flow');
require('../public/backlog-delivery-engine');
globalThis.BLCanonicalFields=require('../server/lib/canonical-fields');
function fixture(){
 const rows=[{ocode:101,model:'Synthetic Backlog',ccode:'01',colour:'Red',qty:100,kalan:40,fob:4,season:'W7',countryRaw:'BANGLADES',buyer:'Demo',buyerGrup:'G',merch:'M',ageGroup:'A',manufacturer:'Demo Supplier',category:'Knit',license:'Demo',line:'Demo',plm:'99',ex:new Date(2026,6,1),retail:new Date(2026,8,1),mb:new Date(2026,9,1)}];
 const XLSX=require('xlsx'),wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet([{'Sipariş Kod':101,'Model Adı':'Synthetic Backlog','Renk Kod':'01','Supplier Portal Statü':'Yol Operasyonları','Yükleme Toplam Adet':60,'Net Alım Sipariş Miktarı':100,'HANDOVER Tarihi':new Date(2026,6,2),'İthalat Dosya No':'DEMO-1','Gemi Ad':'DEMO VESSEL','Vasita Tanim':'Gemi'}]),'IAS');
 const map=parse.parseAntrepoWorkbook(wb),other=[{...rows[0],model:'Other CP target'}];
 return {loadedAt:'demo',asasOrders:other,asasOrdersByTarget:{cp:other,orders:[],backlog:rows},antrepoMap:map};
}
const params={overrides:{},horizons:{},options:{},headers:[],sourceColumns:[],rowsRevision:'rows',sourceRevision:'source-v1',includeSourceDetails:true};
const normalized=rows=>flow.shipmentPartialsFromRows(rows,'backlog').map(({raw,...record})=>record);
test('thin map projection preserves every shipment/filter/priority value while excluding source detail columns',()=>{
 const source=fixture(),full=tasks.buildBacklog('export',source,params),thin=tasks.buildBacklog('export',source,{...params,mapProjection:true});
 assert.ok(full.rows.some(row=>row._detailSource));assert.ok(thin.rows.length>0);
 assert.ok(thin.rows.every(row=>row._flowThin===1&&!Object.hasOwn(row,'_detailSource')));
 assert.deepEqual(normalized(thin.rows),normalized(full.rows));
 assert.equal(thin.sourceRevision,params.sourceRevision);assert.ok(Buffer.byteLength(tasks.serialize(thin))<Buffer.byteLength(tasks.serialize(full))*.75);
 assert.deepEqual(source.asasOrdersByTarget.backlog[0].model,'Synthetic Backlog');
});
test('lazy map details come only from selected identities in the Backlog target and reject stale source revisions',()=>{
 const source=fixture(),full=tasks.buildBacklog('export',source,params),identity={orderCode:101,modelName:'Synthetic Backlog',colourCode:'01'};
 const details=tasks.buildBacklog('map-details',source,{...params,selector:{identities:[identity]},expectedSourceRevision:'source-v1'});
 assert.deepEqual(details.rows,full.rows);assert.ok(details.rows.every(row=>row._detailSource));
 assert.equal(tasks.buildBacklog('map-details',source,{...params,selector:{identities:[{...identity,modelName:'Other CP target'}]},expectedSourceRevision:'source-v1'}).rows.length,0);
 assert.throws(()=>tasks.buildBacklog('map-details',source,{...params,selector:{identities:[identity]},expectedSourceRevision:'old'}),{code:'COMPUTE_STALE_GENERATION'});
});
module.exports={fixture,params};

test('drawer detail loading starts on demand, preserves partial identity, and never borrows CP target rows',async()=>{
 const source=fixture(),full=tasks.buildBacklog('export',source,params),thin=tasks.buildBacklog('export',source,{...params,mapProjection:true});
 const records=flow.shipmentPartialsFromRows(thin.rows.map(row=>({...row,_flowSourceRevision:'source-v1'})),'backlog');let calls=0;
 const request=async(url,options)=>{calls++;assert.equal(url,'/api/backlog-map-details');const body=JSON.parse(options.body);assert.equal(body.sourceRevision,'source-v1');assert.equal(body.identities.length,1);assert.equal(body.identities[0].modelName,'Synthetic Backlog');return {ok:true,json:async()=>({rows:full.rows})};};
 assert.equal(calls,0);const enriched=await flow.resolveMapDetailRecords(records,{request});assert.equal(calls,1);
 assert.deepEqual(enriched.map(({raw,...record})=>record),records.map(({raw,...record})=>record));assert.ok(enriched.every(record=>record.raw._detailSource));
 const cp=flow.shipmentPartialsFromRows([{'Order Code':101,'Model Name':'Other CP target'}],'cp');assert.equal(await flow.resolveMapDetailRecords(cp,{request}),cp);assert.equal(calls,1);
 await assert.rejects(flow.resolveMapDetailRecords(records,{request:async()=>({ok:false,status:409,json:async()=>({error:'Synthetic stale source'})})}),/Synthetic stale source/);
});

'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const D=require('../server/lib/agent-office-decision-support'),I=require('../server/lib/agent-office-intelligence');
const {createAgentOfficeStore}=require('../server/lib/agent-office-store');
const row=(more={})=>({'Order Code':'1234567','PLM ID':'7654321','Model Name':'Demo','C.Code':'BLU','Manufacturer':'Supplier A','Season':'2026SS','Order Quantity':100,'Shipment Quantity':0,'STATUS':'ÜRETİM','Ex-factory':'2026-11-20','Retail Date':'2026-12-20',...more});
test('historical prices use the existing like-for-like engine, explicit currencies and separate seasons',()=>{
 const rows=[];for(const season of ['2025SS','2026SS'])for(let i=0;i<3;i++)rows.push({manufacturer:'A',country:'TR',classification:'Shirt',season,currency:'USD',quantity:100,modelName:'model-'+i,plmId:String(i),fob:season==='2025SS'?10:12,unusedPrivateField:'never-export-this'});
 rows.push({manufacturer:'A',season:'2026SS',currency:'TRY',fob:500,quantity:100,modelName:'other'});rows.push({manufacturer:'A',season:'2026SS',fob:999,quantity:100,modelName:'unknown'});
 const results=D.historicalPrices(rows,new Date().toISOString()),usd=results.find(p=>p.currency==='USD');assert.equal(usd.totals.price,12);assert.equal(usd.totals.previousPrice,10);assert.equal(usd.unverifiedCurrencyRows,1);assert.ok(results.some(p=>p.currency==='TRY'));assert.equal(results.some(p=>p.currency==='UNVERIFIED'),false);assert.ok(!JSON.stringify(results).includes('never-export-this'));assert.ok(!JSON.stringify(results).includes('Items'));assert.ok(!JSON.stringify(results).includes('\"items\"'));
});
test('normalized full BOM enters actual order evidence; legacy BOM stays explicitly incomplete',()=>{
 const full={models:{7654321:{fetchedAt:new Date().toISOString(),fullCoverage:'all-normalized',fullComponents:[{componentCode:'FABRIC-1',componentName:'Cotton jersey',mainCategoryName:'Fabric'}],fullComponentCount:1,components:[]}}};
 const result=I.analyzeOperationalData({cpRows:[row()],cpAvailable:true,bom:full,sourceUpdatedAt:new Date().toISOString()});assert.equal(result.orders[0].bom.coverage,'all-normalized-bom');assert.equal(result.orders[0].bom.components[0].componentCode,'FABRIC-1');assert.ok(!result.orders[0].unavailable.includes('full-fabric-bom'));
 const old=I.analyzeOperationalData({cpRows:[row()],bom:{models:{7654321:{components:[]}}}});assert.ok(old.orders[0].unavailable.includes('full-fabric-bom'));
});
test('collection-only changes are captured without inventing delivery performance or untested quality rates',()=>{
 const a=I.analyzeOperationalData({cpRows:[row()],collectionRows:[{id:'c1',plmId:'7654321',colourCode:'BLU',season:'2026SS',status:'Draft',manufacturer:'Supplier A'}]});
 assert.equal(a.decisionSupport.supplierHistory[0].qualityRejectionRate,null);assert.equal(a.decisionSupport.supplierHistory[0].actualOnTimeRate,null);
 const b=I.analyzeOperationalData({collectionRows:[{id:'c1',plmId:'7654321',colourCode:'BLU',season:'2026SS',status:'Approved'}]});const changes=I.compareSnapshots(a.snapshots,b.snapshots);assert.ok(changes.some(c=>c.key==='collection:c1'&&c.field==='orderStatus'));
});
test('long archived replies remain searchable and contribute bounded marked excerpts to future context',async t=>{
 const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');const root=await fs.mkdtemp(path.join(os.tmpdir(),'bl-agent-history-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));const store=createAgentOfficeStore({root}),agent=await store.createProfile('a',{name:'Ada',areas:['cp']}),conv=await store.conversation('a',[agent.id],'Delivery');
 const body='old detail '.repeat(1000)+' delivery conflict ORDER-123 '+'tail '.repeat(1000).trim();await store.appendMessage('a',conv.id,{role:'assistant',text:body});const context=await store.selectContext('a',[agent.id],conv.id,'delivery conflict',2500);assert.equal(context.selected[0].excerpt,true);assert.ok(context.selected[0].text.includes('delivery conflict'));assert.ok(context.chars<=2500);assert.equal(context.completeArchive,false);
 const matches=await store.searchHistory('a',agent.id,{query:'delivery conflict'});assert.equal(matches.total,1);assert.ok(matches.messages[0].text.includes('delivery conflict'));await assert.rejects(store.searchHistory('b',agent.id,{query:'delivery'}),e=>e.statusCode===404);assert.equal((await store.messages('a',conv.id)).messages[0].text,body);
});

'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path'),Fields=require('../public/canonical-fields'),Lineage=require('../public/price-lineage');
const source=fs.readFileSync(path.join(__dirname,'../public/app-main.js'),'utf8');
const quotes=fs.readFileSync(path.join(__dirname,'../public/quotations.js'),'utf8');
function boot(){
 const row={id:1,modelKod:'DEMO',plmId:'123',colourCode:'01',_rev:4},calls={calc:0,editor:0},context={window:null,state:{storeRevisions:{pricingRules:2}},kolWorkspaceOwnerId:'a',kolWorkspaceRevision:7,kolRows:[row],BLPriceLineage:Lineage,BLCanonicalFields:Fields,BLCanAccessArea:()=>true,BLHasPermission:()=>true,orderLinePeerOwner:()=> 'viewer',kolGroupSummaryEffectiveLandedRow:value=>value,kolLandedCalc:()=>{calls.calc++;return {supp:{source:'confirmed',name:'A'},ydBaseFob:12,ydLanded:13.32,trLanded:10,fx:40,fxIsManual:false,trRule:{id:'tr-rule'},ruleMissing:false,trRuleMissing:false};},kolFindPricingRule:()=>({id:'rule',royalty:20}),kolAutoFx:()=>({rate:40,requestedMonth:'2026-02',resolvedMonth:'2026-01',revision:3}),openSuppFobRulesModal:()=>calls.editor++,document:{getElementById:()=>null}};context.window=context;vm.createContext(context);const start=source.indexOf('function priceLineageBinding('),end=source.indexOf('function contextualCommandRule(',start);vm.runInContext(source.slice(start,end),context);return {context,row,calls,api:context.BLPriceLineageBridge};
}
test('actual adapter reads the canonical calculation once and retains its exact values and rules',()=>{
 const h=boot(),snapshot=h.api.snapshot(h.row,'collection');assert.equal(h.calls.calc,1);assert.equal(snapshot.source.kind,'confirmed');assert.equal(snapshot.source.amount,12);assert.equal(snapshot.values.overseasLanded,13.32);assert.equal(snapshot.rule.id,'rule');assert.equal(snapshot.trRule.id,'tr-rule');assert.equal(snapshot.fx.fallback,true);assert.equal(snapshot.revisions.collection,7);
});
test('actual resolver rejects owner, canonical identity and current module-access changes',()=>{
 const h=boot(),binding=h.api.binding(h.row,'collection');assert.equal(h.api.resolve(binding),h.row);h.context.kolWorkspaceOwnerId='other';assert.equal(h.api.resolve(binding),null);h.context.kolWorkspaceOwnerId='a';h.row.modelKod='OTHER';assert.equal(h.api.resolve(binding),null);h.row.modelKod='DEMO';h.context.BLCanAccessArea=()=>false;assert.equal(h.api.resolve(binding),null);
});
test('resolving a late row normalizes only matching source IDs rather than every model',()=>{
 const h=boot(),row={...h.row,id:3000};h.context.kolRows=Array.from({length:3000},(_,i)=>({...h.row,id:i+1}));const binding=h.api.binding(row,'collection');let reads=0;h.context.BLCanonicalFields={...Fields,canonicalValue:(...args)=>{reads++;return Fields.canonicalValue(...args);}};
 assert.equal(h.api.resolve(binding).id,3000);assert.equal(reads,4);
});
test('actual rule action rechecks management permission and current rule before opening the native editor',()=>{
 const h=boot(),binding=h.api.binding(h.row,'collection');h.context.BLHasPermission=()=>false;assert.equal(h.api.openRule(binding,'rule'),false);assert.equal(h.calls.editor,0);h.context.BLHasPermission=()=>true;assert.equal(h.api.openRule(binding,'stale-rule'),false);assert.equal(h.calls.editor,0);assert.equal(h.api.openRule(binding,'rule'),true);assert.equal(h.calls.editor,1);
});
test('native CP Update fallback metadata is attributed to CP Update instead of a manual entry',()=>{
 const h=boot(),row={_id:3,'Order Code':123,'Model Name':'DEMO','C.Code':'01','Supp. FOB':8.25,_suppFobMeta:{source:'manual',origin:'cpupdate'}};
 Object.assign(h.context,{suppFobMetaForRow:r=>r._suppFobMeta,findSuppFobRule:()=>null,hasManualSuppFob:()=>true,isSuppFobAutoCalculated:()=>false,turknorm:Fields.token,suppFobRuleMissing:()=>false});
 const snapshot=h.api.snapshot(row,'cp');assert.equal(snapshot.source.kind,'cp-update');assert.equal(snapshot.source.amount,8.25);assert.equal(snapshot.source.origin,'cpupdate');
});
test('quotation provenance requires a current model identity as well as a reused row ID',()=>{
 const native=name=>{const start=quotes.indexOf('  function '+name+'('),end=quotes.indexOf('\n  }',start)+4;assert.ok(start>=0&&end>start);return quotes.slice(start,end);};
 const context={qNorm:value=>String(value??'').trim(),qCollectionEffectiveValue:(row,key)=>row[key]};vm.createContext(context);vm.runInContext(native('qIdentityCompatible')+native('qLineMatchesCollectionIdentity'),context);
 const row={id:1,plmId:'123',modelKod:'NEW'};assert.equal(context.qLineMatchesCollectionIdentity({rowId:1,plmId:'999',modelCode:'OLD'},row),false);assert.equal(context.qLineMatchesCollectionIdentity({rowId:1},row),false);assert.equal(context.qLineMatchesCollectionIdentity({rowId:1,plmId:'123',modelCode:'RENAMED'},row),true);
});
